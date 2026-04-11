use std::{
    collections::HashMap,
    time::Duration,
};

use anyhow::Context as _;
use futures::StreamExt;
use libp2p::{
    autonat, gossipsub, identify, kad, mdns, noise, ping,
    swarm::{SwarmEvent, dial_opts::DialOpts},
    tcp, yamux, Multiaddr, PeerId, Swarm,
};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, warn};

use common::{
    config::NodeConfig,
    types::{InferenceBid, InferenceRequest, NodeCapabilities},
};

use crate::{
    behaviour::DeAIBehaviour,
    topics,
};

// ---------------------------------------------------------------------------
// Public event type — sent to the rest of the node
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum P2PEvent {
    InferenceRequestReceived(InferenceRequest),
    BidReceived(InferenceBid),
    NodeAnnounceReceived(NodeCapabilities),
    PeerConnected(PeerId),
    PeerDisconnected(PeerId),
}

// ---------------------------------------------------------------------------
// Commands sent TO the swarm task
// ---------------------------------------------------------------------------

enum SwarmCommand {
    BroadcastInferenceRequest {
        req:  InferenceRequest,
        resp: oneshot::Sender<anyhow::Result<()>>,
    },
    SubscribeModel {
        model_id: String,
        resp:     oneshot::Sender<anyhow::Result<()>>,
    },
    SendBid {
        #[allow(dead_code)]
        peer_id: PeerId,
        bid:     InferenceBid,
        resp:    oneshot::Sender<anyhow::Result<()>>,
    },
    AnnounceCapabilities {
        caps: NodeCapabilities,
        resp: oneshot::Sender<anyhow::Result<()>>,
    },
    Dial {
        addr: Multiaddr,
        resp: oneshot::Sender<anyhow::Result<()>>,
    },
    LocalPeerId {
        resp: oneshot::Sender<PeerId>,
    },
    ConnectedPeers {
        resp: oneshot::Sender<Vec<PeerId>>,
    },
}

// ---------------------------------------------------------------------------
// Handle — the public API, cheap to clone
// ---------------------------------------------------------------------------

/// Async API for the rest of the codebase. The actual swarm runs in its own
/// tokio task; all calls go through a channel.
#[derive(Clone)]
pub struct P2PService {
    cmd_tx: mpsc::Sender<SwarmCommand>,
}

impl P2PService {
    /// Broadcast an inference request to model-specific and catch-all topics.
    pub async fn broadcast_inference_request(
        &self,
        req: &InferenceRequest,
    ) -> anyhow::Result<()> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::BroadcastInferenceRequest {
                req:  req.clone(),
                resp: resp_tx,
            })
            .await
            .context("swarm task gone")?;
        resp_rx.await.context("swarm task dropped response")?
    }

    /// Subscribe to incoming inference requests for the given model.
    pub async fn subscribe_model(&self, model_id: &str) -> anyhow::Result<()> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::SubscribeModel {
                model_id: model_id.to_owned(),
                resp:     resp_tx,
            })
            .await
            .context("swarm task gone")?;
        resp_rx.await.context("swarm task dropped response")?
    }

    /// Send a bid directly to a peer via gossipsub (addressed by peer filter).
    /// For production a direct request-response protocol would be used;
    /// gossipsub is sufficient for the current phase.
    pub async fn send_bid(&self, peer_id: &PeerId, bid: &InferenceBid) -> anyhow::Result<()> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::SendBid {
                peer_id: *peer_id,
                bid:     bid.clone(),
                resp:    resp_tx,
            })
            .await
            .context("swarm task gone")?;
        resp_rx.await.context("swarm task dropped response")?
    }

    /// Announce this node's capabilities to the network.
    pub async fn announce_capabilities(&self, caps: &NodeCapabilities) -> anyhow::Result<()> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::AnnounceCapabilities {
                caps: caps.clone(),
                resp: resp_tx,
            })
            .await
            .context("swarm task gone")?;
        resp_rx.await.context("swarm task dropped response")?
    }

    /// Dial a multiaddr (used for bootstrap nodes).
    pub async fn dial(&self, addr: Multiaddr) -> anyhow::Result<()> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::Dial { addr, resp: resp_tx })
            .await
            .context("swarm task gone")?;
        resp_rx.await.context("swarm task dropped response")?
    }

    /// Return this node's PeerId.
    pub async fn local_peer_id(&self) -> anyhow::Result<PeerId> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::LocalPeerId { resp: resp_tx })
            .await
            .context("swarm task gone")?;
        Ok(resp_rx.await.context("swarm task dropped response")?)
    }

    /// Return a snapshot of currently connected peer IDs.
    pub async fn connected_peers(&self) -> anyhow::Result<Vec<PeerId>> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::ConnectedPeers { resp: resp_tx })
            .await
            .context("swarm task gone")?;
        Ok(resp_rx.await.context("swarm task dropped response")?)
    }
}

// ---------------------------------------------------------------------------
// Builder — creates the swarm and spawns the event loop
// ---------------------------------------------------------------------------

/// Build a `P2PService` from config, spawn its event loop, and return both
/// the service handle and a receiver for inbound events.
pub async fn build(
    config: &NodeConfig,
) -> anyhow::Result<(P2PService, mpsc::Receiver<P2PEvent>)> {
    let swarm = build_swarm(config)?;

    let (cmd_tx, cmd_rx) = mpsc::channel(256);
    let (event_tx, event_rx) = mpsc::channel(256);

    tokio::spawn(swarm_task(swarm, cmd_rx, event_tx, config.clone()));

    Ok((P2PService { cmd_tx }, event_rx))
}

// ---------------------------------------------------------------------------
// Swarm construction
// ---------------------------------------------------------------------------

fn build_swarm(_config: &NodeConfig) -> anyhow::Result<Swarm<DeAIBehaviour>> {
    let swarm = libp2p::SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|keypair: &libp2p::identity::Keypair| {
            let peer_id = keypair.public().to_peer_id();

            // -- Gossipsub --
            let gs_config = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_millis(200))
                // Mesh thresholds: allow mesh with as few as 1 peer so dev /
                // test networks with small node counts still route correctly.
                .mesh_n(2)
                .mesh_n_low(1)
                .mesh_n_high(8)
                .mesh_outbound_min(0)
                // Anonymous: message origin is authenticated at the libp2p
                // transport layer (noise); we don't need gossipsub-level signing.
                .validation_mode(gossipsub::ValidationMode::None)
                .build()
                .expect("gossipsub config valid");
            let mut gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Anonymous,
                gs_config,
            )
            .expect("gossipsub init");

            // Subscribe to static topics at startup.
            for topic in [
                topics::node_announce_topic(),
                topics::node_health_topic(),
                topics::inference_any_topic(),
                topics::reputation_topic(),
            ] {
                gossipsub.subscribe(&topic).expect("subscribe static topic");
            }

            // -- Kademlia --
            let kademlia = kad::Behaviour::new(
                peer_id,
                kad::store::MemoryStore::new(peer_id),
            );

            // -- Identify --
            let identify = identify::Behaviour::new(identify::Config::new(
                "/deai/1.0.0".into(),
                keypair.public(),
            ));

            // -- Ping --
            let ping = ping::Behaviour::new(
                ping::Config::new().with_interval(Duration::from_secs(30)),
            );

            // -- AutoNAT --
            let autonat = autonat::Behaviour::new(peer_id, autonat::Config::default());

            // -- mDNS --
            let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id)
                .expect("mdns init");

            Ok(DeAIBehaviour { gossipsub, kademlia, identify, ping, autonat, mdns })
        })?
        .with_swarm_config(|cfg: libp2p::swarm::Config| {
            cfg.with_idle_connection_timeout(Duration::from_secs(60))
        })
        .build();

    Ok(swarm)
}

// ---------------------------------------------------------------------------
// Swarm event loop
// ---------------------------------------------------------------------------

async fn swarm_task(
    mut swarm: Swarm<DeAIBehaviour>,
    mut cmd_rx: mpsc::Receiver<SwarmCommand>,
    event_tx: mpsc::Sender<P2PEvent>,
    config: NodeConfig,
) {
    // Bind listen address
    let listen_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{}", config.network.listen_port)
        .parse()
        .expect("valid listen addr");

    if let Err(e) = swarm.listen_on(listen_addr.clone()) {
        error!(%e, "failed to bind P2P listen address");
        return;
    }
    info!(%listen_addr, "P2P listening");

    // Dial bootstrap nodes
    for addr_str in &config.network.bootstrap_nodes {
        match addr_str.parse::<Multiaddr>() {
            Ok(addr) => {
                if let Err(e) = swarm.dial(DialOpts::unknown_peer_id().address(addr.clone()).build()) {
                    warn!(%addr, %e, "failed to dial bootstrap node");
                } else {
                    debug!(%addr, "dialling bootstrap node");
                }
            }
            Err(e) => warn!(%addr_str, %e, "invalid bootstrap multiaddr"),
        }
    }

    // Track topic hash → model_id for model-specific inference topics
    let mut model_topics: HashMap<libp2p::gossipsub::TopicHash, String> = HashMap::new();

    loop {
        tokio::select! {
            // ---- swarm events ----
            event = swarm.next() => {
                let Some(event) = event else { break };
                handle_swarm_event(event, &event_tx, &mut model_topics).await;
            }

            // ---- commands from the rest of the node ----
            cmd = cmd_rx.recv() => {
                let Some(cmd) = cmd else { break };
                handle_command(cmd, &mut swarm, &mut model_topics);
            }
        }
    }
    info!("P2P swarm task exiting");
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

fn handle_command(
    cmd: SwarmCommand,
    swarm: &mut Swarm<DeAIBehaviour>,
    model_topics: &mut HashMap<libp2p::gossipsub::TopicHash, String>,
) {
    match cmd {
        SwarmCommand::BroadcastInferenceRequest { req, resp } => {
            let result = (|| -> anyhow::Result<()> {
                let payload = serde_json::to_vec(&req)?;
                let model_topic = topics::inference_topic(&req.model_preference);
                let any_topic   = topics::inference_any_topic();

                // Model-specific publish is best-effort (not all nodes subscribe to
                // every model). Ignore InsufficientPeers on this topic.
                if let Err(e) = swarm.behaviour_mut().gossipsub.publish(model_topic, payload.clone()) {
                    if !matches!(e, gossipsub::PublishError::InsufficientPeers) {
                        return Err(anyhow::anyhow!("model-topic publish: {e}"));
                    }
                }

                // The catch-all topic must succeed — it's how the network knows
                // a request is available regardless of model.
                swarm.behaviour_mut().gossipsub.publish(any_topic, payload)?;
                Ok(())
            })();
            let _ = resp.send(result);
        }

        SwarmCommand::SubscribeModel { model_id, resp } => {
            let topic = topics::inference_topic(&model_id);
            let hash  = topic.hash();
            let result = swarm
                .behaviour_mut()
                .gossipsub
                .subscribe(&topic)
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!("{e}"));
            if result.is_ok() {
                model_topics.insert(hash, model_id);
            }
            let _ = resp.send(result);
        }

        SwarmCommand::SendBid { peer_id: _, bid, resp } => {
            // Bids are published on the inference/any topic; the client-side
            // SDK filters by request_id to find bids intended for it.
            // A direct request-response stream is added in Phase 2 extension.
            let result = (|| -> anyhow::Result<()> {
                let payload = serde_json::to_vec(&bid)?;
                let topic   = topics::inference_any_topic();
                swarm.behaviour_mut().gossipsub.publish(topic, payload)?;
                Ok(())
            })();
            let _ = resp.send(result);
        }

        SwarmCommand::AnnounceCapabilities { caps, resp } => {
            let result = (|| -> anyhow::Result<()> {
                let payload = serde_json::to_vec(&caps)?;
                let topic   = topics::node_announce_topic();
                swarm.behaviour_mut().gossipsub.publish(topic, payload)?;
                Ok(())
            })();
            let _ = resp.send(result);
        }

        SwarmCommand::Dial { addr, resp } => {
            let result = swarm
                .dial(DialOpts::unknown_peer_id().address(addr).build())
                .map_err(|e| anyhow::anyhow!("{e}"));
            let _ = resp.send(result);
        }

        SwarmCommand::LocalPeerId { resp } => {
            let _ = resp.send(*swarm.local_peer_id());
        }

        SwarmCommand::ConnectedPeers { resp } => {
            let peers: Vec<PeerId> = swarm.connected_peers().copied().collect();
            let _ = resp.send(peers);
        }
    }
}

// ---------------------------------------------------------------------------
// Swarm event handler
// ---------------------------------------------------------------------------

async fn handle_swarm_event(
    event: SwarmEvent<crate::behaviour::DeAIBehaviourEvent>,
    event_tx: &mpsc::Sender<P2PEvent>,
    model_topics: &HashMap<libp2p::gossipsub::TopicHash, String>,
) {
    match event {
        SwarmEvent::NewListenAddr { address, .. } => {
            info!(%address, "new listen address");
        }

        SwarmEvent::ConnectionEstablished { peer_id, .. } => {
            info!(%peer_id, "peer connected");
            let _ = event_tx.send(P2PEvent::PeerConnected(peer_id)).await;
        }

        SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
            debug!(%peer_id, ?cause, "peer disconnected");
            let _ = event_tx.send(P2PEvent::PeerDisconnected(peer_id)).await;
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Gossipsub(
            gossipsub::Event::Message { message, .. },
        )) => {
            dispatch_gossipsub_message(message, event_tx, model_topics).await;
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Gossipsub(
            gossipsub::Event::Subscribed { peer_id, topic },
        )) => {
            debug!(%peer_id, %topic, "gossipsub: peer subscribed");
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Gossipsub(
            gossipsub::Event::Unsubscribed { peer_id, topic },
        )) => {
            debug!(%peer_id, %topic, "gossipsub: peer unsubscribed");
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Gossipsub(
            gossipsub::Event::GossipsubNotSupported { peer_id },
        )) => {
            warn!(%peer_id, "gossipsub not supported by peer");
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Mdns(
            mdns::Event::Discovered(peers),
        )) => {
            for (peer_id, addr) in peers {
                debug!(%peer_id, %addr, "mDNS discovered peer");
            }
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Mdns(
            mdns::Event::Expired(peers),
        )) => {
            for (peer_id, _) in peers {
                debug!(%peer_id, "mDNS peer expired");
            }
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Identify(
            identify::Event::Received { peer_id, info, .. },
        )) => {
            debug!(%peer_id, protocols = ?info.protocols, "identify received");
        }

        SwarmEvent::Behaviour(crate::behaviour::DeAIBehaviourEvent::Ping(
            ping::Event { peer, result, .. },
        )) => {
            match result {
                Ok(rtt) => debug!(%peer, ?rtt, "ping"),
                Err(e)  => warn!(%peer, %e, "ping failed"),
            }
        }

        SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
            warn!(?peer_id, %error, "outgoing connection error");
        }

        _ => {}
    }
}

async fn dispatch_gossipsub_message(
    message: gossipsub::Message,
    event_tx: &mpsc::Sender<P2PEvent>,
    model_topics: &HashMap<libp2p::gossipsub::TopicHash, String>,
) {
    let topic = topics::KnownTopic::from_hash(&message.topic);

    match topic {
        topics::KnownTopic::InferenceAny | topics::KnownTopic::InferenceModel(_) => {
            // Try decoding as InferenceRequest first, then InferenceBid.
            if let Ok(req) = serde_json::from_slice::<InferenceRequest>(&message.data) {
                let _ = event_tx.send(P2PEvent::InferenceRequestReceived(req)).await;
            } else if let Ok(bid) = serde_json::from_slice::<InferenceBid>(&message.data) {
                let _ = event_tx.send(P2PEvent::BidReceived(bid)).await;
            } else {
                // Also check model-specific topic subscriptions
                if model_topics.contains_key(&message.topic) {
                    if let Ok(req) = serde_json::from_slice::<InferenceRequest>(&message.data) {
                        let _ = event_tx.send(P2PEvent::InferenceRequestReceived(req)).await;
                    }
                }
                debug!("unrecognised inference topic payload");
            }
        }

        topics::KnownTopic::NodeAnnounce => {
            if let Ok(caps) =
                serde_json::from_slice::<NodeCapabilities>(&message.data)
            {
                let _ = event_tx.send(P2PEvent::NodeAnnounceReceived(caps)).await;
            }
        }

        topics::KnownTopic::NodeHealth | topics::KnownTopic::Reputation => {
            // Handled by future phases (reputation system, health aggregator).
            debug!(topic = ?message.topic, "received health/reputation message");
        }

        topics::KnownTopic::Unknown(hash) => {
            debug!(%hash, "message on unknown topic");
        }
    }
}

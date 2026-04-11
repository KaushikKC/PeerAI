//! Minimal gossipsub sanity check — no service wrapper.

use std::time::Duration;

use futures::StreamExt;
use libp2p::{
    gossipsub, identify, mdns, noise, ping, swarm::SwarmEvent, tcp, yamux,
    Multiaddr, SwarmBuilder,
};

fn make_swarm(port: u16) -> libp2p::Swarm<MiniBehaviour> {
    let mut swarm = SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )
        .expect("tcp")
        .with_behaviour(|keypair: &libp2p::identity::Keypair| {
            let peer_id = keypair.public().to_peer_id();
            let gs_cfg = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_millis(100))
                .mesh_n(2)
                .mesh_n_low(1)
                .mesh_n_high(8)
                .mesh_outbound_min(0)
                .validation_mode(gossipsub::ValidationMode::None)
                .build()
                .unwrap();
            let mut gossipsub =
                gossipsub::Behaviour::new(gossipsub::MessageAuthenticity::Anonymous, gs_cfg)
                    .unwrap();
            gossipsub
                .subscribe(&gossipsub::IdentTopic::new("test/topic"))
                .unwrap();
            Ok(MiniBehaviour {
                gossipsub,
                identify: identify::Behaviour::new(identify::Config::new(
                    "/test/1.0.0".into(),
                    keypair.public(),
                )),
                ping: ping::Behaviour::default(),
            })
        })
        .expect("behaviour")
        .build();

    let addr: Multiaddr = format!("/ip4/127.0.0.1/tcp/{port}").parse().unwrap();
    swarm.listen_on(addr).unwrap();
    swarm
}

#[derive(libp2p::swarm::NetworkBehaviour)]
struct MiniBehaviour {
    gossipsub: gossipsub::Behaviour,
    identify:  identify::Behaviour,
    ping:      ping::Behaviour,
}

#[tokio::test]
async fn test_minimal_gossipsub() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();

    let mut swarm_a = make_swarm(4200);
    let mut swarm_b = make_swarm(4201);

    // Let both swarms bind.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // B dials A.
    swarm_b
        .dial("/ip4/127.0.0.1/tcp/4200".parse::<Multiaddr>().unwrap())
        .unwrap();

    let topic = gossipsub::IdentTopic::new("test/topic");
    let mut connected = false;
    let mut b_received = false;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

    loop {
        if tokio::time::Instant::now() > deadline {
            panic!("timeout — connected={connected} b_received={b_received}");
        }

        tokio::select! {
            event = swarm_a.next() => match event.unwrap() {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    eprintln!("A: peer connected {peer_id}");
                    connected = true;
                }
                SwarmEvent::Behaviour(MiniBehaviourEvent::Gossipsub(
                    gossipsub::Event::Subscribed { peer_id, topic: t },
                )) => {
                    eprintln!("A: peer {peer_id} subscribed to {t}");
                    // Peer B is now known to subscribe to test/topic — publish.
                    swarm_a
                        .behaviour_mut()
                        .gossipsub
                        .publish(topic.clone(), b"hello from A")
                        .expect("publish should succeed now");
                    eprintln!("A: published");
                }
                _ => {}
            },

            event = swarm_b.next() => match event.unwrap() {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    eprintln!("B: peer connected {peer_id}");
                }
                SwarmEvent::Behaviour(MiniBehaviourEvent::Gossipsub(
                    gossipsub::Event::Message { message, .. },
                )) => {
                    eprintln!("B: received message: {:?}", message.data);
                    b_received = true;
                }
                _ => {}
            },
        }

        if b_received {
            break;
        }
    }

    assert!(b_received, "B never received the message from A");
}

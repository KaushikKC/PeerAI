'use client';

import { useCallback, useEffect, useState } from 'react';
import { useScrollProgress } from './hooks/useScrollProgress';
import { useRevealOnScroll } from './hooks/useRevealOnScroll';
import { useCounters } from './hooks/useCounters';
import { useModelTabs } from './hooks/useModelTabs';
import { useFlowLines } from './hooks/useFlowLines';
import { useCardEffects } from './hooks/useCardEffects';
import { useTicker } from './hooks/useTicker';
import { useHeroGradient } from './hooks/useHeroGradient';
import { useWordReveal } from './hooks/useWordReveal';
import { useFloatingLabels } from './hooks/useFloatingLabels';

const CornerSVG = () => (
  <svg viewBox="0 0 10 10"><path d="M0,10 L0,0 L10,0" stroke="#fff" fill="none"/></svg>
);

function SecLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[22px] flex items-center gap-2.5 font-mono text-[0.62rem] uppercase tracking-[0.3em] text-(--fg-3)">
      <span className="inline-block h-px w-[22px] flex-shrink-0 bg-white"></span>
      {children}
    </div>
  );
}

const CORNER_POS = {
  tl: 'top-1 left-1',
  tr: 'top-1 right-1 rotate-90',
  bl: 'bottom-1 left-1 -rotate-90',
  br: 'bottom-1 right-1 rotate-180',
} as const;
const Corner = ({ pos }: { pos: keyof typeof CORNER_POS }) => (
  <div className={`pointer-events-none absolute size-2.5 opacity-0 [transition:opacity_.4s_var(--e)] group-hover:opacity-100 ${CORNER_POS[pos]}`}>
    <CornerSVG />
  </div>
);

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('error');
        setMsg(data.error || 'Something went wrong.');
      }
    } catch {
      setStatus('error');
      setMsg('Network error — please try again.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 flex cursor-pointer border-none bg-none p-1 text-(--fg-3) transition-colors duration-200 hover:text-(--fg)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg>
        </button>
        <div className="mb-3.5 font-mono text-[0.58rem] uppercase tracking-[0.28em] text-(--fg-3)">Join the waitlist</div>
        {status === 'success' ? (
          <div className="flex flex-col items-start gap-3">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white opacity-90"><path d="M5 12l5 5 9-9"/><circle cx="12" cy="12" r="10"/></svg>
            <h3 className="m-0 font-display text-[1.55rem] font-medium leading-[1.2] text-white">You&apos;re on the list.</h3>
            <p className="m-0 text-[0.88rem] leading-[1.6] text-(--fg-2)">We&apos;ll reach out when early access opens. Phase C is live — Ed25519 identity and signed-receipt settlement work today.</p>
          </div>
        ) : (
          <>
            <h3 className="mb-2.5 mt-0 font-display text-[1.55rem] font-medium leading-[1.2] text-white">Early access to Pinaivu AI</h3>
            <p className="mb-6 mt-0 text-[0.88rem] leading-[1.6] text-(--fg-2)">Be among the first to run a node or use the network. No token, no chain required.</p>
            <form onSubmit={submit} className="flex flex-col gap-2.5">
              <div className="flex overflow-hidden border border-(--line-h)">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="modal-input"
                />
                <button type="submit" disabled={status === 'loading'} className="flex cursor-pointer items-center gap-1 border-none bg-white px-5 py-3 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-black whitespace-nowrap transition-opacity duration-200 hover:opacity-85 disabled:cursor-default disabled:opacity-50">
                  {status === 'loading' ? <span className="modal-spinner"></span> : <><span>Request Access</span><span className="arrow"> ↗</span></>}
                </button>
              </div>
              {status === 'error' && <div className="border border-[rgba(248,113,113,0.25)] bg-[rgba(248,113,113,0.06)] px-3 py-2 font-mono text-[0.72rem] text-[#f87171]">{msg}</div>}
            </form>
            <div className="mt-2.5 font-mono text-[0.6rem] tracking-[0.08em] text-(--fg-4)">No spam. Unsubscribe any time.</div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [showWaitlist, setShowWaitlist] = useState(false);

  useScrollProgress();
  useRevealOnScroll();
  useCounters();
  useModelTabs();
  useFlowLines();
  useCardEffects();
  useTicker();
  useHeroGradient();
  useWordReveal();
  useFloatingLabels();

  const toggleTheme = useCallback(() => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pinaivu-theme', next); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowWaitlist(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative z-[1]">
      {showWaitlist && <WaitlistModal onClose={() => setShowWaitlist(false)} />}
      {/* Scroll Progress */}
      <div className="prog"><div className="prog-bar" id="progBar"></div></div>

      {/* NAV */}
      <nav
        className="fixed left-0 right-0 top-0 z-100 flex justify-center px-(--content-pad) pt-4 transition-all duration-300"
        id="nav"
      >
        <div className="pointer-events-auto flex w-full max-w-[1160px] items-center gap-4 rounded-full border border-(--line-2) bg-black/85 px-4 py-2 shadow-[0_10px_32px_rgba(0,0,0,.35)] backdrop-blur-xl">
          <a
            href="#top"
            className="flex items-center gap-2 whitespace-nowrap font-mono text-[0.78rem] font-semibold uppercase tracking-[0.06em]"
          >
            <span className="grid h-[22px] w-[22px] place-items-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="5"/>
                <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                <line x1="12" y1="2" x2="12" y2="6"/>
                <line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="6" y2="12"/>
                <line x1="18" y1="12" x2="22" y2="12"/>
              </svg>
            </span>
            Pinaivu AI
          </a>
          <ul className="hidden flex-1 items-center justify-center gap-1 md:flex">
            <li><a className="rounded-full px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-(--fg-3) transition-colors hover:bg-(--fg-5) hover:text-(--fg)" href="#problem">Problem</a></li>
            <li><a className="rounded-full px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-(--fg-3) transition-colors hover:bg-(--fg-5) hover:text-(--fg)" href="#features">Features</a></li>
            <li><a className="rounded-full px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-(--fg-3) transition-colors hover:bg-(--fg-5) hover:text-(--fg)" href="#flow">Flow</a></li>
            <li><a className="rounded-full px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-(--fg-3) transition-colors hover:bg-(--fg-5) hover:text-(--fg)" href="#models">Models</a></li>
            <li><a className="rounded-full px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-(--fg-3) transition-colors hover:bg-(--fg-5) hover:text-(--fg)" href="#tech">Tech</a></li>
            <li><a className="rounded-full px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-(--fg-3) transition-colors hover:bg-(--fg-5) hover:text-(--fg)" href="#roadmap">Roadmap</a></li>
          </ul>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            <svg className="moon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          </button>
          <button
            className="rounded-full bg-(--inv) px-5 py-2.5 font-mono text-[0.68rem] font-semibold uppercase tracking-widest text-(--inv-fg) transition-opacity hover:opacity-90"
            onClick={() => setShowWaitlist(true)}
          >
            <span>Join Waitlist <span className="arrow">↗</span></span>
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative flex max-h-[1040px] min-h-[720px] flex-col overflow-hidden isolate bg-(--bg) [transition:background_var(--theme-t)] h-screen" id="top">
        <canvas id="hero-canvas" className="hidden"></canvas>
        <div className="absolute inset-0 z-0 pointer-events-none [background:radial-gradient(circle_600px_at_var(--mx,50%)_var(--my,50%),var(--grad-a)_0%,var(--grad-b)_25%,transparent_60%),var(--grad-base)] [transition:background_.12s_ease-out]" id="heroGradient"></div>
        <div className="hero-grid-sm"></div>
        <div className="hero-grid"></div>
        <div className="hero-crosshair"></div>
        <div className="absolute inset-0 z-[1] pointer-events-none opacity-75 [background:radial-gradient(ellipse_at_center,transparent_24%,var(--bg)_100%)]"></div>
        <div className="scanlines"></div>
        <div className="hero-corners"><span className="hc-bl"></span><span className="hc-br"></span></div>
        <div className="hero-glyphs" id="heroGlyphs"></div>
        <div className="hero-marker tl"><span className="dot"></span> 0x<span id="heroHash">3f2a9b…c417</span></div>
        <div className="hero-marker tr">Ed25519 / Merkle / libp2p <span className="bar"></span></div>
        <div className="hero-marker bl">v2.0 · April 2026 · Living Document</div>
        <div className="relative z-[3] flex flex-1 flex-col justify-between pb-16 pt-24">
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-(--content-pad) text-center">
            <div data-float className="inline-flex items-center gap-2 rounded-full border border-(--line-2) bg-(--fg-6) px-3.5 py-[7px] font-mono text-[0.62rem] uppercase tracking-[0.25em] text-(--fg-2) backdrop-blur-md">
              <span className="size-1.5 rounded-full bg-white shadow-[0_0_8px_#fff] [animation:pulse-dot_1.8s_ease-in-out_infinite]"></span>
              Phase C · Protocol v2.0 · Zero blockchain required
            </div>
            <div data-float className="flex items-center gap-3 font-mono text-[0.6rem] uppercase tracking-[0.35em] text-(--fg-3)">
              <span className="h-px w-6 bg-(--line-2)"></span>
              A P2P Inference Protocol · 2026
              <span className="h-px w-6 bg-(--line-2)"></span>
            </div>
            <h1 className="hero-title">
              <span className="word"><span>Trust</span></span>
              <span className="word"><span>from</span></span>
              <span className="word"><span><em>cryptography,</em></span></span>
              <span className="word"><span>not chains.</span></span>
            </h1>
            <p className="max-w-[620px] text-[1.05rem] leading-[1.65] text-(--fg-2) opacity-0 [animation:fade-in_1s_var(--e)_1.3s_forwards]">Pinaivu AI grounds every guarantee in <strong className="text-(--fg) font-medium">Ed25519 signatures</strong> and <strong className="text-(--fg) font-medium">SHA-256 Merkle proofs</strong> — not a coordinator, not a token. Settlement, storage and anchoring are <strong className="text-(--fg) font-medium">pluggable</strong>. Swap a TOML value, not your stack.</p>
            <div className="mb-7 flex flex-wrap justify-center gap-2.5 opacity-0 [animation:fade-in_1s_var(--e)_1.6s_forwards]">
              <button className="relative inline-flex items-center gap-2.5 overflow-hidden isolate rounded-full bg-(--inv) px-6 py-3.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-(--inv-fg) [transition:background_.25s,color_.25s,border-color_.25s]" onClick={() => setShowWaitlist(true)}>
                <span className="relative z-[2]">Join Waitlist</span>
                <span className="relative z-[2]">↗</span>
              </button>
              <a className="relative inline-flex items-center gap-2.5 overflow-hidden isolate rounded-full border border-(--line-2) bg-[rgba(10,10,10,.5)] px-6 py-3.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-(--fg) backdrop-blur-md [transition:background_.25s,color_.25s,border-color_.25s] hover:border-(--fg) hover:bg-[rgba(20,20,20,.7)]" href="/PinaivuAI_Whitepaper.pdf" target="_blank" rel="noopener noreferrer">
                <span>Read Whitepaper v2.0</span>
              </a>
            </div>
          </div>
          <div className="relative z-[3] flex h-[46px] w-full items-center overflow-hidden border-y border-(--line) bg-(--fg-5) backdrop-blur-[10px]">
            <div className="track h-full items-center" id="ticker">
              <span>ED25519 IDENTITY</span><span>SHA-256 MERKLE TREE</span><span>GOSSIPSUB REPUTATION</span><span>AES-256-GCM SESSIONS</span><span>X25519 CONTEXT KEYS</span><span>SIGNED PROOF OF INFERENCE</span><span>SETTLEMENT-AGNOSTIC ESCROW</span><span>LIBP2P · QUIC · NOISE</span><span>IPFS · WALRUS · LOCAL</span><span>FREE · RECEIPT · CHANNEL · SUI · EVM</span><span>STANDARD · PRIVATE · FRAGMENTED · MAXIMUM</span><span>OFFLINE VERIFIABLE</span>
            </div>
          </div>
        </div>
        {/* <div className="hero-scroll">Scroll<div className="line"></div>↓</div> */}
      </section>

      {/* STATS */}
      <section className="mt-8" style={{padding:0}}>
        <div className="mx-auto grid max-w-(--content-max) grid-cols-1 gap-0 px-(--content-pad) md:grid-cols-2 xl:grid-cols-4" id="stats">
          <div
            className="stat group relative -ml-px -mt-px border border-(--line) px-8 py-10 transition-[background-color,border-color,box-shadow,transform] duration-300 hover:bg-(--bg-1) [&.in-view_.stat-bar]:w-(--pct,60%)"
            style={{ '--pct': '100%' } as React.CSSProperties}
          >
            <div className="mb-4 flex items-baseline gap-1 font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none tracking-[-0.035em]"><span data-count="5">0</span><span className="font-mono text-[0.8rem] font-medium tracking-[0.02em] text-(--fg-2)">/5</span></div>
            <div className="flex items-center justify-between font-mono text-[0.58rem] uppercase tracking-[0.25em] text-(--fg-3)">Guarantees met <span className="inline-flex items-center gap-1 font-semibold text-(--fg)">G1–G5</span></div>
            <div className="stat-bar absolute bottom-0 left-0 h-[2px] w-0 bg-white transition-[width] duration-1600 ease-[cubic-bezier(.2,.8,.2,1)] delay-100"></div>
          </div>
          <div
            className="stat group relative -ml-px -mt-px border border-(--line) px-8 py-10 transition-[background-color,border-color,box-shadow,transform] duration-300 hover:bg-(--bg-1) [&.in-view_.stat-bar]:w-(--pct,60%)"
            style={{ '--pct': '100%' } as React.CSSProperties}
          >
            <div className="mb-4 flex items-baseline gap-1 font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none tracking-[-0.035em]"><span data-count="0">0</span></div>
            <div className="flex items-center justify-between font-mono text-[0.58rem] uppercase tracking-[0.25em] text-(--fg-3)">Blockchains required <span className="inline-flex items-center gap-1 font-semibold text-(--fg)">Optional</span></div>
            <div className="stat-bar absolute bottom-0 left-0 h-[2px] w-0 bg-white transition-[width] duration-1600 ease-[cubic-bezier(.2,.8,.2,1)] delay-100"></div>
          </div>
          <div
            className="stat group relative -ml-px -mt-px border border-(--line) px-8 py-10 transition-[background-color,border-color,box-shadow,transform] duration-300 hover:bg-(--bg-1) [&.in-view_.stat-bar]:w-(--pct,60%)"
            style={{ '--pct': '100%' } as React.CSSProperties}
          >
            <div className="mb-4 flex items-baseline gap-1 font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none tracking-[-0.035em]"><span data-count="6">0</span></div>
            <div className="flex items-center justify-between font-mono text-[0.58rem] uppercase tracking-[0.25em] text-(--fg-3)">Stack layers <span className="inline-flex items-center gap-1 font-semibold text-(--fg)">Swappable</span></div>
            <div className="stat-bar absolute bottom-0 left-0 h-[2px] w-0 bg-white transition-[width] duration-1600 ease-[cubic-bezier(.2,.8,.2,1)] delay-100"></div>
          </div>
          <div
            className="stat group relative -ml-px -mt-px border border-(--line) px-8 py-10 transition-[background-color,border-color,box-shadow,transform] duration-300 hover:bg-(--bg-1) [&.in-view_.stat-bar]:w-(--pct,60%)"
            style={{ '--pct': '100%' } as React.CSSProperties}
          >
            <div className="mb-4 flex items-baseline gap-1 font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none tracking-[-0.035em]"><span data-count="128">0</span><span className="font-mono text-[0.8rem] font-medium tracking-[0.02em] text-(--fg-2)">-bit</span></div>
            <div className="flex items-center justify-between font-mono text-[0.58rem] uppercase tracking-[0.25em] text-(--fg-3)">Ed25519 security <span className="inline-flex items-center gap-1 font-semibold text-(--fg)">RFC 8032</span></div>
            <div className="stat-bar absolute bottom-0 left-0 h-[2px] w-0 bg-white transition-[width] duration-1600 ease-[cubic-bezier(.2,.8,.2,1)] delay-100"></div>
          </div>
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="relative max-w-(--content-max) mx-auto p-0 max-[720px]:py-[60px] max-[720px]:px-(--content-pad)" id="manifesto">
        <div className="relative px-(--content-pad)">
          <div className="m-label"><b>§ 001</b> Thesis <span style={{color:'var(--fg-3)'}}>· Drafted for the open network · v2.0</span></div>
          <div className="m-grid">

            <div className="m-cell m-thesis">
              <div className="m-meta"><span>Abstract · Line 01</span><span><b>Self-sufficient</b></span></div>
              <h2>
                Every prior inference marketplace grounds trust in a <em>coordinator</em> or a <em>specific chain</em>. Pinaivu AI takes a third path: trust is grounded <span className="hl">exclusively in cryptography</span> &mdash; Ed25519 identity, SHA-256 Merkle proofs, AES-256-GCM sessions. Any chain becomes an <em>optional anchor</em> on a system that already works.
              </h2>
              <div className="m-sig"><span>Offline verifiable</span><span>No coordinator</span><span>Chain-optional</span></div>
            </div>

            <div className="m-cell m-spec">
              <div>
                <div className="spec-k">Primitive · 01</div>
                <div className="spec-v">Proof<em> of Inference</em></div>
              </div>
              <div className="spec-d">A signed execution receipt verifiable offline with only the producing node&apos;s public key.</div>
              <div className="m-meta"><span>π = (req, model, tᵢ, tₒ, Δ, H_in, H_out, pk, σ)</span></div>
            </div>

            <div className="m-cell m-code">
              <div><span className="c"># verify π offline — no network, no chain</span></div>
              <div><span className="k">let</span> msg = canonical(π)</div>
              <div><span className="k">let</span> vk  = VerifyingKey::<span className="s">from_bytes</span>(π.pk_N)</div>
              <div><span className="k">assert</span> EdDSA::<span className="s">verify</span>(vk, msg, π.σ)</div>
              <div><span className="c"># O(1) — constant time</span></div>
            </div>

            <div className="m-cell m-kv"><div className="k">G1</div><div className="v">Session<em> privacy</em></div><div className="m-meta"><span>Client-held K</span><span>X25519 DH</span></div></div>
            <div className="m-cell m-kv"><div className="k">G2</div><div className="v">Node<em> accountability</em></div><div className="m-meta"><span>Ed25519 σ</span><span>Merkle π</span></div></div>
            <div className="m-cell m-tick"><div><div className="tv">∅</div>Zero blockchain required</div></div>
            <div className="m-cell m-dot-mtx"></div>

            <div className="m-cell m-kv"><div className="k">G3</div><div className="v">Settlement<em> neutrality</em></div><div className="m-meta"><span>free · receipt · channel · sui · evm</span></div></div>
            <div className="m-cell m-kv"><div className="k">G4</div><div className="v">Storage<em> neutrality</em></div><div className="m-meta"><span>local · ipfs · walrus</span></div></div>

            <div className="m-cell m-ring">
              <svg viewBox="0 0 70 70">
                <circle className="bg" cx="35" cy="35" r="30"/>
                <circle className="fg" cx="35" cy="35" r="30"/>
              </svg>
              <div className="lbl">5/5</div>
            </div>
            <div className="m-cell m-kv"><div className="k">G5</div><div className="v">Permissionless<em> participation</em></div><div className="m-meta"><span>libp2p PeerId = pk_N</span></div></div>

            <div className="m-cell m-barchart"><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div><div className="b"></div></div>
            <div className="m-cell m-kv"><div className="k">Reputation</div><div className="v">score(N)<em> = α·ṡ + β·ℓ</em></div><div className="m-meta"><span>α=0.6</span><span>β=0.4</span><span>L_max=5s</span></div></div>
            <div className="m-cell m-kv"><div className="k">Gossip</div><div className="v">600s<em> · broadcast root</em></div><div className="m-meta"><span>/pinaivu/reputation/1.0.0</span></div></div>
          </div>
        </div>
      </section>

      {/* PROBLEMS */}
      <section id="problem">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">002</b> · The Failure Mode</SecLabel>
            <h2 className="sec-title reveal">Cloud AI bakes in <em>three consequences</em><br/>that aren&apos;t technical requirements.</h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">For every turn (P, C, R), today&apos;s provider observes all three, sets price ρ unilaterally, and revokes access at will. None of this is forced by the maths &mdash; only by the architecture.</p>
        </div>
        <div className="grid grid-cols-3 gap-0 px-(--content-pad) max-w-(--content-max) mx-auto max-[1280px]:grid-cols-2 max-[720px]:grid-cols-1">
          <div data-card data-prob className="group reveal relative -ml-px -mt-px flex min-h-[380px] flex-col justify-between border border-(--line) px-9 pb-9 pt-11 [transition:border-color_.4s_var(--e),background_.4s_var(--e)] hover:border-(--line-h) hover:bg-(--bg-2)">
            <div>
              <div className="mb-6 flex items-center justify-between font-mono text-[0.58rem] tracking-[0.25em] text-(--fg-3)">
                <span>01 — Context exposure</span>
                <span className="rounded-full border border-(--line-2) px-2 py-0.5 text-[0.5rem] tracking-[0.2em] text-(--fg) [animation:breathe_4s_ease-in-out_infinite]">G1</span>
              </div>
              <div className="relative my-3 h-[140px] grid place-items-center">
                <div className="viz-choke">
                  <svg viewBox="0 0 200 140" preserveAspectRatio="xMidYMid meet"><line x1="30" y1="20" x2="100" y2="70"/><line x1="30" y1="70" x2="100" y2="70"/><line x1="30" y1="120" x2="100" y2="70"/><line x1="170" y1="20" x2="100" y2="70"/><line x1="170" y1="70" x2="100" y2="70"/><line x1="170" y1="120" x2="100" y2="70"/></svg>
                  <div className="node" style={{top:'14%',left:'15%'}}></div><div className="node" style={{top:'50%',left:'15%'}}></div><div className="node" style={{top:'86%',left:'15%'}}></div>
                  <div className="node" style={{top:'14%',left:'85%'}}></div><div className="node" style={{top:'50%',left:'85%'}}></div><div className="node" style={{top:'86%',left:'85%'}}></div>
                  <div className="node center"></div>
                </div>
              </div>
              <h3 className="mb-3 font-display font-normal text-[1.65rem] leading-[1.1] tracking-[-0.02em] [font-variation-settings:'opsz'_144]">Provider sees (P, C, R)</h3>
              <p className="text-[0.88rem] text-(--fg-2) leading-[1.65]">Every prompt, every accumulated context, every response flows through one party. Pinaivu AI keeps the full session C encrypted under a client-held key K; the GPU node sees only the decrypted context window for the current turn.</p>
            </div>
            <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
          </div>
          <div data-card data-prob className="group reveal reveal-d1 relative -ml-px -mt-px flex min-h-[380px] flex-col justify-between border border-(--line) px-9 pb-9 pt-11 [transition:border-color_.4s_var(--e),background_.4s_var(--e)] hover:border-(--line-h) hover:bg-(--bg-2)">
            <div>
              <div className="mb-6 flex items-center justify-between font-mono text-[0.58rem] tracking-[0.25em] text-(--fg-3)">
                <span>02 — Chain dependence</span>
                <span className="rounded-full border border-(--line-2) px-2 py-0.5 text-[0.5rem] tracking-[0.2em] text-(--fg) [animation:breathe_4s_ease-in-out_infinite]">G3</span>
              </div>
              <div className="relative my-3 h-[140px] grid place-items-center"><div className="viz-lock"><div className="viz-lock-shape"></div></div></div>
              <h3 className="mb-3 font-display font-normal text-[1.65rem] leading-[1.1] tracking-[-0.02em] [font-variation-settings:'opsz'_144]">One token, one ecosystem</h3>
              <p className="text-[0.88rem] text-(--fg-2) leading-[1.65]">Bittensor collapses without TAO. Every prior decentralised inference system grounds trust in a specific chain, token and validator set. Pinaivu AI&apos;s trust model is self-sufficient; any chain is an optional settlement adapter selected in a TOML file.</p>
            </div>
            <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
          </div>
          <div data-card data-prob className="group reveal reveal-d2 relative -ml-px -mt-px flex min-h-[380px] flex-col justify-between border border-(--line) px-9 pb-9 pt-11 [transition:border-color_.4s_var(--e),background_.4s_var(--e)] hover:border-(--line-h) hover:bg-(--bg-2)">
            <div>
              <div className="mb-6 flex items-center justify-between font-mono text-[0.58rem] tracking-[0.25em] text-(--fg-3)">
                <span>03 — Unverifiable work</span>
                <span className="rounded-full border border-(--line-2) px-2 py-0.5 text-[0.5rem] tracking-[0.2em] text-(--fg) [animation:breathe_4s_ease-in-out_infinite]">G2</span>
              </div>
              <div className="relative my-3 h-[140px] grid place-items-center"><div className="viz-down"><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div></div></div>
              <h3 className="mb-3 font-display font-normal text-[1.65rem] leading-[1.1] tracking-[-0.02em] [font-variation-settings:'opsz'_144]">No receipt, no recourse</h3>
              <p className="text-[0.88rem] text-(--fg-2) leading-[1.65]">Batch marketplaces (io.net, Akash) and routers (Fortytwo) can&apos;t prove node N ran job J at the claimed parameters. Pinaivu AI ships every response with a self-verifiable ProofOfInference — Ed25519-signed, offline checkable, binding on (model, tokens, Δ, H_in, H_out).</p>
            </div>
            <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">003</b> · Six Layers</SecLabel>
            <h2 className="sec-title reveal">Every layer is <em>independently replaceable.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">Layers interact only through trait interfaces. Layer 0 (Crypto) has no external deps. Every layer above it may use external infra, but none is required.</p>
        </div>
        <div className="grid grid-cols-3 gap-0 px-(--content-pad) max-w-(--content-max) mx-auto max-[1280px]:grid-cols-2 max-[720px]:grid-cols-1">
          {[
            { delay: '', layer: 'L · 06 · Application', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>, title: 'OpenAI-compatible surface', body: 'TypeScript SDK, drop-in HTTP API, Web UI. Change the base URL; keep your code. Streaming, sessions and proof retrieval are native.', foot: 'TS SDK · HTTP · Web UI' },
            { delay: 'reveal-d1', layer: 'L · 05 · Session', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>, title: 'E2E encrypted memory', body: 'Full history C is AES-256-GCM encrypted under a client-held K. The GPU node decrypts only the active context window — never C, never K.', foot: 'AES-GCM · X25519 · Portable' },
            { delay: 'reveal-d2', layer: 'L · 04 · Reputation', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><path d="M12 10V8M12 16v-2M10 12H8M16 12h-2"/></svg>, title: 'Merkle tree, gossiped', body: 'Every node keeps a Merkle tree of its signed proofs. The root is broadcast over libp2p gossipsub every 10 min. Chain anchoring is optional.', foot: 'SHA-256 · Gossipsub · O(log n)' },
            { delay: '', layer: 'L · 03 · Marketplace', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12l9-9 9 9-9 9z"/><path d="M8 12h8M12 8v8"/></svg>, title: '200ms sealed-bid auction', body: 'Client broadcasts request; nodes pass six cheap-to-expensive checks and submit a bid. Composite score (0.4×price + 0.3×latency + 0.3×rep) picks the winner.', foot: 'libp2p · Sealed-bid · First-price' },
            { delay: 'reveal-d1', layer: 'L · 02 · Settlement', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.2"/><path d="M6 10v4M18 10v4"/></svg>, title: 'Pluggable escrow', body: 'Five adapters: free, signed-receipt, off-chain channel, Sui, EVM. Pick in TOML; same binary. Payment channels amortise gas 50× over 100 requests.', foot: 'free · receipt · channel · sui · evm' },
            { delay: 'reveal-d2', layer: 'L · 01 · Storage', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="12" cy="5" rx="8" ry="2.5"/><path d="M4 5v14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5"/><path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"/></svg>, title: 'Content-addressed, agnostic', body: 'Three-method interface: put/get/delete. Local, IPFS, Walrus, Memory — same protocol. SHA-256 IDs mean put(b)=put(b) deduplicates for free.', foot: 'local · ipfs · walrus' },
          ].map(({ delay, layer, icon, title, body, foot }) => (
            <div key={title} data-card className={`group reveal ${delay} relative -ml-px -mt-px flex min-h-[320px] flex-col justify-between overflow-hidden border border-(--line) px-9 pt-10 pb-9 [transition:border-color_.4s_var(--e),background_.4s_var(--e)] hover:border-(--line-h) hover:bg-(--bg-2)`}>
              <div>
                <div className="mb-[30px] flex items-start justify-between">
                  <div className="font-mono text-[0.58rem] tracking-[0.25em] text-(--fg-3)">{layer}</div>
                  <div className="grid size-11 place-items-center border border-(--line-2) [animation:breathe_5s_ease-in-out_infinite] [transition:all_.4s_var(--e)] will-change-[transform,opacity] group-hover:border-white group-hover:bg-white">
                    <svg className="size-5 text-white [transition:transform_.5s_var(--e)] group-hover:rotate-[8deg] group-hover:scale-110 group-hover:text-black" viewBox={(icon as React.ReactElement).props.viewBox} fill="none" stroke="currentColor" strokeWidth="1.5">{(icon as React.ReactElement).props.children}</svg>
                  </div>
                </div>
                <h3 className="mb-2.5 font-display font-normal text-[1.5rem] leading-[1.15] tracking-[-0.02em] [font-variation-settings:'opsz'_144]">{title}</h3>
                <p className="mb-5 text-[0.86rem] text-(--fg-2) leading-[1.65]">{body}</p>
              </div>
              <div className="flex items-center justify-between border-t border-dashed border-(--line-2) pt-[18px] font-mono text-[0.56rem] uppercase tracking-[0.2em] text-(--fg-3)">
                {foot}
                <span className="-translate-x-1.5 text-(--fg) opacity-0 [transition:all_.4s_var(--e)] group-hover:translate-x-0 group-hover:opacity-100">→</span>
              </div>
              <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
            </div>
          ))}
        </div>
      </section>

      {/* FLOW */}
      <section className="flow py-[72px] px-(--content-pad) max-w-(--content-max) mx-auto" id="flow">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">004</b> · Request Flow</SecLabel>
            <h2 className="sec-title reveal">From prompt to proof, <em>in under a second.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">Four stages. Each one cryptographically verifiable — from the sealed-bid auction through Ed25519-signed proof delivery.</p>
        </div>
        <div className="relative min-h-[560px] overflow-hidden border border-(--line) bg-(--bg-1) px-12 py-[88px] before:absolute before:inset-0 before:pointer-events-none before:bg-[linear-gradient(var(--fg-6)_1px,transparent_1px),linear-gradient(90deg,var(--fg-6)_1px,transparent_1px)] before:[background-size:40px_40px] before:opacity-40 max-[720px]:px-[18px] max-[720px]:py-11">
          <div className="relative z-[1] mx-auto grid max-w-[1100px] grid-cols-4 gap-0 max-xl:grid-cols-2 max-xl:gap-y-8 max-[720px]:grid-cols-1 max-[720px]:gap-0" id="flowStage">
            {[
              { n: 1, step: 'Step 01 · ~5ms', title: 'Broadcast', body: "Client broadcasts an InferenceRequest on the gossipsub topic for the required model, carrying model ID, budget, and privacy level — not the context (that stays client-side until a winner is chosen).", svg: <><path d="M12 2v14"/><path d="M6 12l6 6 6-6"/><rect x="4" y="18" width="16" height="4"/></> },
              { n: 2, step: 'Step 02 · 200ms', title: 'Sealed-bid Auction', body: 'GPU nodes pass six checks (model, capacity, queue, budget, privacy, throttle) and submit bids. Client picks winner by composite score: 0.4×price + 0.3×latency + 0.3×reputation.', svg: <><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></> },
              { n: 3, step: 'Step 03 · ~620ms', title: 'Inference', body: "Client encrypts the context window W for the winning node via X25519 DH and sends it directly to that node's API. Node decrypts W in RAM, runs inference, streams tokens back, then zeroes W.", svg: <><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/><line x1="7" y1="8" x2="7" y2="12"/><line x1="11" y1="8" x2="11" y2="12"/><line x1="15" y1="8" x2="15" y2="12"/></> },
              { n: 4, step: 'Step 04 · ~20ms', title: 'Proof + Settle', body: 'Node signs ProofOfInference π binding (model, tokens, Δ, H_in, H_out) with Ed25519. π is appended to the node\'s Merkle tree. Settlement adapter executes and ships π to the client.', svg: <><path d="M5 12l5 5 9-9"/><circle cx="12" cy="12" r="10"/></> },
            ].map(({ n, step, title, body, svg }) => (
              <div key={n} className="flow-step group relative px-5 py-7 text-center">
                <div className="relative mx-auto mb-[22px] grid size-24 place-items-center border border-(--line-h) bg-(--bg) transition-all duration-500 [transition-timing-function:var(--e)] before:absolute before:inset-[-6px] before:border before:border-(--fg-4) before:opacity-0 before:transition-opacity before:duration-500 group-hover:border-white group-hover:bg-(--inv) group-hover:text-(--inv-fg) group-hover:before:opacity-100 group-hover:before:inset-[-10px]">
                  <span className="absolute -top-2.5 -right-2.5 z-[2] grid size-7 place-items-center rounded-full bg-(--inv) font-mono text-[0.6rem] font-bold text-(--inv-fg)">{n}</span>
                  <svg className="size-[34px] transition-transform duration-500 [transition-timing-function:var(--e)] group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{svg}</svg>
                </div>
                <div className="mb-2 font-mono text-[0.56rem] uppercase tracking-[0.25em] text-(--fg-3)">{step}</div>
                <h4 className="mb-2 font-display font-medium text-[1.1rem] [font-variation-settings:'opsz'_144]">{title}</h4>
                <p className="text-[0.78rem] text-(--fg-2) leading-[1.55]">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 grid grid-cols-3 border-t border-(--line) pt-8">
            <div className="px-6 border-r border-(--line-2) last:border-r-0">
              <div className="mb-1 font-mono text-[1.2rem] font-medium"><span data-count="845">0</span>ms</div>
              <div className="font-mono text-[0.55rem] tracking-[0.2em] uppercase text-(--fg-3)">Total · end to end</div>
            </div>
            <div className="px-6 border-r border-(--line-2) last:border-r-0">
              <div className="mb-1 font-mono text-[1.2rem] font-medium">42<span style={{color:'var(--fg-3)'}}>tok/s</span></div>
              <div className="font-mono text-[0.55rem] tracking-[0.2em] uppercase text-(--fg-3)">Throughput · 70B model</div>
            </div>
            <div className="px-6 border-r border-(--line-2) last:border-r-0">
              <div className="mb-1 font-mono text-[1.2rem] font-medium">0.0003<span style={{color:'var(--fg-3)'}}> PEER</span></div>
              <div className="font-mono text-[0.55rem] tracking-[0.2em] uppercase text-(--fg-3)">Cost · 256 tokens</div>
            </div>
          </div>
        </div>
      </section>

      {/* MODELS */}
      <section id="models">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">005</b> · Model Catalog</SecLabel>
            <h2 className="sec-title reveal">Run the models you want. <em>Not the ones they allow.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">Every open-weight checkpoint that fits in VRAM. Pre-cached for the popular ones, on-demand for the rest.</p>
        </div>
        <div className="px-(--content-pad) max-w-(--content-max) mx-auto">
          <div className="flex items-end justify-between mb-7 gap-6 flex-wrap">
            <div className="flex rounded-full border border-(--line-2) bg-(--bg-1) p-1" id="modelTabs">
              <button className="tab active font-mono text-[0.62rem] tracking-[0.18em] uppercase py-[9px] px-[18px] rounded-full text-(--fg-3) transition-all duration-300 font-medium" data-tab="llm">Language</button>
              <button className="tab font-mono text-[0.62rem] tracking-[0.18em] uppercase py-[9px] px-[18px] rounded-full text-(--fg-3) transition-all duration-300 font-medium" data-tab="vision">Vision</button>
              <button className="tab font-mono text-[0.62rem] tracking-[0.18em] uppercase py-[9px] px-[18px] rounded-full text-(--fg-3) transition-all duration-300 font-medium" data-tab="audio">Audio</button>
            </div>
            <div style={{fontFamily:'var(--mono)',fontSize:'.58rem',letterSpacing:'.22em',textTransform:'uppercase',color:'var(--fg-3)'}}>
              <span style={{color:'#fff'}}>84</span> models live · <span style={{color:'#fff'}}>2,847</span> variants
            </div>
          </div>
          <div className="models-box grid grid-cols-[1.1fr_1fr] min-h-[460px] border border-(--line) bg-(--bg-1) max-lg:grid-cols-1">

            <div className="model-panel active" id="panel-llm">
              <div className="models-pane p-12 border-r border-(--line) flex flex-col justify-between relative overflow-hidden max-lg:border-r-0 max-lg:border-b max-lg:border-b-(--line)">
                <div>
                  <div className="models-meta font-mono text-[0.58rem] tracking-[0.25em] uppercase text-(--fg-3) flex gap-3 mb-4"><span className="pill">LLM</span><span className="pill">Text</span><span className="pill">FP16 · INT8 · INT4</span></div>
                  <h3 className="font-display font-normal text-[2.4rem] leading-none tracking-[-0.025em] mb-3 [font-variation-settings:'opsz'_144]">Llama 3.1 · 405B</h3>
                  <div className="font-mono text-[0.72rem] text-(--fg-2) mb-6">Meta · Open weights · Released Jul 2024</div>
                  <p className="text-[0.92rem] text-(--fg-2) leading-[1.6] mb-7 max-w-[440px]">The largest open LLM running on the network. Sharded across 16 consumer GPUs via tensor parallel. Competitive with GPT-4 on most benchmarks at a fraction of the cost.</p>
                </div>
                <div className="models-spec grid grid-cols-2 gap-px bg-(--line) border border-(--line)">
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Parameters</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">405<span className="text-(--fg-2) font-normal">B</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Context</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">128<span className="text-(--fg-2) font-normal">K tokens</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Throughput</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">42<span className="text-(--fg-2) font-normal"> tok/s</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Cost / 1K</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">$0.003</div></div>
                </div>
              </div>
              <div className="terminal bg-black font-mono text-[0.75rem] leading-[1.75] flex flex-col">
                <div className="flex items-center gap-1.5 border-b border-(--line) px-[18px] py-3.5">
                  <div className="size-2 rounded-full border border-(--fg-3)"></div><div className="size-2 rounded-full border border-(--fg-3)"></div><div className="size-2 rounded-full border border-(--fg-3)"></div>
                  <div className="ml-auto font-mono text-[0.56rem] tracking-[0.25em] uppercase text-(--fg-3)">peer-cli · llama-3.1-405b</div>
                </div>
                <div className="flex-1 overflow-y-auto p-[22px_20px]" data-term="llm"></div>
              </div>
            </div>

            <div className="model-panel" id="panel-vision">
              <div className="models-pane p-12 border-r border-(--line) flex flex-col justify-between relative overflow-hidden max-lg:border-r-0 max-lg:border-b max-lg:border-b-(--line)">
                <div>
                  <div className="models-meta font-mono text-[0.58rem] tracking-[0.25em] uppercase text-(--fg-3) flex gap-3 mb-4"><span className="pill">Vision</span><span className="pill">Diffusion</span><span className="pill">1024²</span></div>
                  <h3 className="font-display font-normal text-[2.4rem] leading-none tracking-[-0.025em] mb-3 [font-variation-settings:'opsz'_144]">FLUX.1 · Pro</h3>
                  <div className="font-mono text-[0.72rem] text-(--fg-2) mb-6">Black Forest Labs · Open weights · Aug 2024</div>
                  <p className="text-[0.92rem] text-(--fg-2) leading-[1.6] mb-7 max-w-[440px]">State-of-the-art text-to-image at 1024² native resolution. Runs on a single consumer GPU. 4-step Turbo variant generates in under 1 second per image.</p>
                </div>
                <div className="models-spec grid grid-cols-2 gap-px bg-(--line) border border-(--line)">
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Resolution</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">1024<span className="text-(--fg-2) font-normal">×1024</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Steps</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">4<span className="text-(--fg-2) font-normal"> (turbo)</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Latency</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">2.1<span className="text-(--fg-2) font-normal">s</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Cost / img</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">$0.004</div></div>
                </div>
              </div>
              <div className="terminal bg-black font-mono text-[0.75rem] leading-[1.75] flex flex-col">
                <div className="flex items-center gap-1.5 border-b border-(--line) px-[18px] py-3.5">
                  <div className="size-2 rounded-full border border-(--fg-3)"></div><div className="size-2 rounded-full border border-(--fg-3)"></div><div className="size-2 rounded-full border border-(--fg-3)"></div>
                  <div className="ml-auto font-mono text-[0.56rem] tracking-[0.25em] uppercase text-(--fg-3)">peer-cli · flux-1-pro</div>
                </div>
                <div className="flex-1 overflow-y-auto p-[22px_20px]" data-term="vision"></div>
              </div>
            </div>

            <div className="model-panel" id="panel-audio">
              <div className="models-pane p-12 border-r border-(--line) flex flex-col justify-between relative overflow-hidden max-lg:border-r-0 max-lg:border-b max-lg:border-b-(--line)">
                <div>
                  <div className="models-meta font-mono text-[0.58rem] tracking-[0.25em] uppercase text-(--fg-3) flex gap-3 mb-4"><span className="pill">Audio</span><span className="pill">STT</span><span className="pill">Streaming</span></div>
                  <h3 className="font-display font-normal text-[2.4rem] leading-none tracking-[-0.025em] mb-3 [font-variation-settings:'opsz'_144]">Whisper · Large v3</h3>
                  <div className="font-mono text-[0.72rem] text-(--fg-2) mb-6">OpenAI · Open weights · MIT license</div>
                  <p className="text-[0.92rem] text-(--fg-2) leading-[1.6] mb-7 max-w-[440px]">99-language speech-to-text with automatic language detection. Runs 52× realtime on an RTX 3090. Native WebSocket streaming for voice applications.</p>
                </div>
                <div className="models-spec grid grid-cols-2 gap-px bg-(--line) border border-(--line)">
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Languages</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">99</div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Speed</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">52×<span className="text-(--fg-2) font-normal"> realtime</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">TTFT</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">&lt;300<span className="text-(--fg-2) font-normal">ms</span></div></div>
                  <div className="bg-(--bg-1) p-4 flex flex-col gap-1"><div className="font-mono text-[0.54rem] tracking-[0.22em] uppercase text-(--fg-3)">Cost / min</div><div className="font-mono text-[0.92rem] text-(--fg) font-medium">$0.001</div></div>
                </div>
              </div>
              <div className="terminal bg-black font-mono text-[0.75rem] leading-[1.75] flex flex-col">
                <div className="flex items-center gap-1.5 border-b border-(--line) px-[18px] py-3.5">
                  <div className="size-2 rounded-full border border-(--fg-3)"></div><div className="size-2 rounded-full border border-(--fg-3)"></div><div className="size-2 rounded-full border border-(--fg-3)"></div>
                  <div className="ml-auto font-mono text-[0.56rem] tracking-[0.25em] uppercase text-(--fg-3)">peer-cli · whisper-v3-large</div>
                </div>
                <div className="flex-1 overflow-y-auto p-[22px_20px]" data-term="audio"></div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section id="compare">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">006</b> · Comparison</SecLabel>
            <h2 className="sec-title reveal">Against the <em>incumbents.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">Every prior system either lacks G2 (no verifiable accountability) or sacrifices G3/G4 (hard-coded chain and storage). Pinaivu AI is the first to satisfy all five guarantees simultaneously.</p>
        </div>
        <div className="px-(--content-pad) max-w-(--content-max) mx-auto">
          <div className="compare-box border border-(--line) bg-(--bg-1) overflow-hidden reveal">
            <div className="compare-row head grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">Property</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">Pinaivu AI</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">Bittensor</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">QVAC</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">io.net</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">Fortytwo</div>
            </div>
            <div className="compare-row grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2"><span className="rowtitle">G1 — Session privacy</span></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg> AES-256-GCM</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> Validators see all</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> Not addressed</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)">N/A · batch only</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> Centralised</div>
            </div>
            <div className="compare-row grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2"><span className="rowtitle">G2 — Node accountability</span></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg> Ed25519 + Merkle</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">Partial · validators</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> No receipts</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> No receipts</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> No receipts</div>
            </div>
            <div className="compare-row grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2"><span className="rowtitle">G3 — Settlement neutrality</span></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg> 5 adapters</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> TAO only</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">No payment</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> IO token</div>
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2">N/A · centralised</div>
            </div>
            <div className="compare-row grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2"><span className="rowtitle">G5 — Permissionless</span></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg> PeerId = pk_N</div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> KYC required</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg> Centralised</div>
            </div>
            <div className="compare-row grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2"><span className="rowtitle">Persistent sessions</span></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg> E2E encrypted</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
            </div>
            <div className="compare-row grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] border-b border-(--line) transition-colors duration-200">
              <div className="compare-cell px-6 py-5 border-r border-(--line) text-[0.86rem] text-(--fg-2) flex items-center gap-2"><span className="rowtitle">Streaming responses</span></div>
              <div className="compare-cell yes px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l5 5 9-9"/></svg> Native WebSocket</div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
              <div className="compare-cell no px-6 py-5 border-r border-(--line) text-[0.86rem] flex items-center gap-2 text-(--fg-3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18l12-12"/></svg></div>
            </div>
          </div>
        </div>
      </section>

      {/* TECH */}
      <section id="tech">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">007</b> · Stack</SecLabel>
            <h2 className="sec-title reveal">Built on <em>proven primitives.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">No reinvention for its own sake. Every layer is a battle-tested open-source component, assembled specifically for GPU compute coordination.</p>
        </div>
        <div className="grid grid-cols-3 gap-0 px-(--content-pad) max-w-(--content-max) mx-auto max-[1280px]:grid-cols-2 max-[720px]:grid-cols-1">
          {([
            { delay: '', id: 'T · 01', title: 'libp2p Transport', body: 'TCP + QUIC dual-stack with Noise authenticated encryption and Yamux stream multiplexing. AutoNAT traversal means any home node can participate without port-forwarding.', tags: ['TCP','QUIC','Noise','Yamux'] },
            { delay: 'reveal-d1', id: 'T · 02', title: 'Kademlia DHT + Gossipsub', body: 'Kademlia DHT for peer routing and mDNS for local discovery. Five gossipsub topics carry inference requests, bids, announcements and Merkle root broadcasts.', tags: ['Kademlia','mDNS','Gossipsub','5 topics'] },
            { delay: 'reveal-d2', id: 'T · 03', title: 'Ed25519 Identity', body: 'Every node is an Ed25519 keypair. The libp2p PeerId is derived from pk_N — no separate account or wallet needed. 128-bit security per RFC 8032.', tags: ['Ed25519','RFC 8032','128-bit security'] },
            { delay: '', id: 'T · 04', title: 'ProofOfInference', body: "A signed execution receipt bound to (model, tokens, latency, H_in, H_out). Verifiable offline with only the node's public key. Constant-time O(1) verification, no network call.", tags: ['Ed25519 σ','SHA-256 H_in/H_out','Offline'] },
            { delay: 'reveal-d1', id: 'T · 05', title: 'AES-256-GCM Sessions', body: 'Session context encrypted under a client-held key K derived from X25519 DH. The GPU node never sees K — only the current-turn context window, zeroed from RAM after inference.', tags: ['AES-256-GCM','X25519','96-bit nonce'] },
            { delay: 'reveal-d2', id: 'T · 06', title: 'Settlement Adapters', body: 'Five adapters behind one interface: free, signed-receipt, off-chain payment channel, Sui (Phase D), EVM (Phase E). All selected by a single TOML key — same binary, zero code changes.', tags: ['free','receipt','channel','sui','evm'] },
          ] as const).map(({ delay, id, title, body, tags }) => (
            <div key={id} data-card className={`group reveal ${delay} relative -ml-px -mt-px min-h-[260px] overflow-hidden border border-(--line) px-9 pt-10 pb-9 transition-all duration-[400ms] [transition-timing-function:var(--e)] after:absolute after:top-0 after:left-0 after:right-0 after:h-0.5 after:bg-white after:scale-x-0 after:origin-left after:transition-transform after:duration-500 after:[transition-timing-function:var(--e)] hover:border-(--line-h) hover:bg-(--bg-2) hover:after:scale-x-100`}>
              <div className="mb-5 flex items-start justify-between gap-4">
                <h4 className="font-display font-medium text-[1.25rem] tracking-[-0.015em] [font-variation-settings:'opsz'_144]">{title}</h4>
                <div className="font-mono text-[0.56rem] tracking-[0.25em] text-(--fg-3) whitespace-nowrap">{id}</div>
              </div>
              <p className="mb-[18px] text-[0.84rem] text-(--fg-2) leading-[1.65]">{body}</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <span key={t} className="border border-(--line-2) px-2 py-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-(--fg-2) transition-[border-color] duration-300 group-hover:border-(--fg-3)">{t}</span>
                ))}
              </div>
              <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
            </div>
          ))}
        </div>
      </section>

      {/* HARDWARE */}
      <section id="hardware">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">008</b> · Fleet</SecLabel>
            <h2 className="sec-title reveal">The GPUs <em>behind the mesh.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">A live breakdown of the hardware running inference right now. Consumer cards dominate the network — by design.</p>
        </div>
        <div className="grid grid-cols-4 gap-0 px-(--content-pad) max-w-(--content-max) mx-auto max-[1024px]:grid-cols-2 max-[720px]:grid-cols-1" id="hwGrid">
          {([
            { delay: '', pct: '68%', label: 'RTX 4090', spec: '24GB · 82.6 TFLOPS', share: '68%' },
            { delay: 'reveal-d1', pct: '18%', label: 'RTX 3090', spec: '24GB · 35.6 TFLOPS', share: '18%' },
            { delay: 'reveal-d2', pct: '9%', label: 'A100 · 80GB', spec: '80GB HBM2e · 312 TFLOPS', share: '9%' },
            { delay: 'reveal-d3', pct: '5%', label: 'Other', spec: '4080 · 4070 · M-series · more', share: '5%' },
          ] as const).map(({ delay, pct, label, spec, share }) => (
            <div key={label} data-card className={`group reveal ${delay} relative -ml-px -mt-px flex min-h-[320px] flex-col overflow-hidden border border-(--line) px-8 pt-10 pb-8 transition-all duration-[400ms] [transition-timing-function:var(--e)] hover:border-(--line-h) hover:bg-(--bg-2)`} style={{'--pct': pct} as React.CSSProperties}>
              <div className="relative mb-6 grid h-[100px] place-items-center border border-dashed border-(--line) transition-[border-color] duration-[400ms] group-hover:border-(--fg-3)">
                <div className="relative grid size-14 place-items-center border border-white transition-transform duration-[600ms] [transition-timing-function:var(--e)] group-hover:rotate-45 group-hover:scale-110
                  before:absolute before:-top-2 before:bottom-[-8px] before:left-1/2 before:w-px before:bg-white before:-translate-x-1/2
                  after:absolute after:-left-2 after:right-[-8px] after:top-1/2 after:h-px after:bg-white after:-translate-y-1/2">
                  <span className="size-2 rounded-sm bg-white"></span>
                </div>
              </div>
              <div className="mb-1.5 font-display font-medium text-[1.25rem] tracking-[-0.015em] [font-variation-settings:'opsz'_144]">{label}</div>
              <div className="mb-5 font-mono text-[0.62rem] tracking-[0.05em] text-(--fg-2)">{spec}</div>
              <div className="mt-auto">
                <div className="mb-2 flex justify-between font-mono text-[0.52rem] uppercase tracking-[0.2em] text-(--fg-3)"><span>Network share</span><span>{share}</span></div>
                <div className="relative h-1 overflow-hidden bg-(--fg-5)"><div className="hw-bar-fill"></div></div>
              </div>
              <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
            </div>
          ))}
        </div>
      </section>

      {/* ROADMAP */}
      <section id="roadmap">
        <div className="grid grid-cols-2 gap-14 items-end px-(--content-pad) max-w-(--content-max) mx-auto mb-[60px] max-lg:grid-cols-1 max-lg:gap-4 max-[720px]:mb-7">
          <div>
            <SecLabel><b className="text-white font-semibold">009</b> · Timeline</SecLabel>
            <h2 className="sec-title reveal">From testnet <em>to full mesh.</em></h2>
          </div>
          <p className="reveal reveal-d1 text-[0.97rem] text-(--fg-2) leading-[1.72] max-w-[500px] justify-self-end pb-2.5 max-lg:justify-self-start">Four phases. Shipping cadence tied to node-count milestones, not marketing dates.</p>
        </div>
        <div className="grid grid-cols-4 gap-0 px-(--content-pad) max-w-(--content-max) mx-auto max-[1024px]:grid-cols-2 max-[720px]:grid-cols-1">
          {([
            { delay: '', active: true, p: '1', tag: 'Live', date: 'Phase C · April 2026', title: 'Cryptographic Core', items: ['Ed25519 identity + ProofOfInference','Merkle reputation tree + gossip','Free + signed-receipt settlement','Local + IPFS + Walrus storage'] },
            { delay: 'reveal-d1', active: false, p: '0', tag: 'Queued', date: 'Phase D · H2 2026', title: 'Sui Settlement', items: ['Move escrow smart contract','SuiSettlement adapter live','On-chain proof verification','Reputation anchoring on Sui'] },
            { delay: 'reveal-d2', active: false, p: '0', tag: 'Queued', date: 'Phase E · H1 2027', title: 'EVM Settlement', items: ['Solidity escrow contract · Base L2','EvmSettlement adapter live','Multi-chain settlement matrix','TOML-selectable chains'] },
            { delay: 'reveal-d3', active: false, p: '0', tag: 'Queued', date: 'Phase F · H2 2027', title: 'On-Chain Channels', items: ['Payment channels — on-chain close','50× gas amortisation at 100 req/session','Full gossip protocol live','Governance parameterisation'] },
          ] as const).map(({ delay, active, p, tag, date, title, items }) => (
            <div key={title} data-card className={`group reveal ${delay} relative -ml-px -mt-px flex min-h-[360px] flex-col overflow-hidden border px-9 pt-10 pb-9 transition-all duration-[400ms] [transition-timing-function:var(--e)] hover:border-(--line-h) hover:bg-(--bg-2) ${active ? 'border-white bg-(--bg-2) [animation:phase-glow_2.5s_ease-in-out_infinite]' : 'border-(--line)'}`} style={{'--p': p} as React.CSSProperties}>
              <span className={`mb-6 inline-flex items-center gap-1.5 font-mono text-[0.54rem] uppercase tracking-[0.25em] ${active ? 'text-white' : 'text-(--fg-3)'}`}>
                {active && <span className="size-1.5 rounded-full bg-white [animation:pulse-dot_1.8s_ease-in-out_infinite]"></span>}
                {tag}
              </span>
              <div className="mb-1.5 font-mono text-[0.56rem] tracking-[0.25em] text-(--fg-3)">{date}</div>
              <div className="mb-[22px] font-display font-normal text-[1.55rem] tracking-[-0.02em] [font-variation-settings:'opsz'_144]">{title}</div>
              <ul className="mt-auto flex flex-col gap-2.5 list-none">
                {items.map(item => (
                  <li key={item} className="relative pl-[18px] font-mono text-[0.72rem] text-(--fg-2) leading-[1.5] before:absolute before:left-0 before:top-2 before:h-px before:w-2 before:bg-(--fg-3) before:transition-[width,background] before:duration-300 group-hover:before:w-3 group-hover:before:bg-white">{item}</li>
                ))}
              </ul>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-(--fg-5) after:absolute after:inset-0 after:bg-white after:origin-left after:transition-transform after:duration-[1400ms] after:[transition-timing-function:var(--e)] after:delay-200" style={{'--p': p, transform: `scaleX(${p})`} as React.CSSProperties}></div>
              <Corner pos="tl"/><Corner pos="tr"/><Corner pos="bl"/><Corner pos="br"/>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <div className="py-[120px] px-(--content-pad) max-w-(--content-max) mx-auto max-[720px]:py-[68px]" id="cta">
        <div className="relative overflow-hidden border border-(--line) py-[108px] px-[68px] text-center max-[720px]:px-6 max-[720px]:py-[60px]">
          <div className="absolute inset-0 pointer-events-none opacity-50 [background-image:linear-gradient(var(--fg-6)_1px,transparent_1px),linear-gradient(90deg,var(--fg-6)_1px,transparent_1px)] [background-size:50px_50px]"></div>
          <div className="absolute inset-0 pointer-events-none [background:radial-gradient(ellipse_at_50%_120%,rgba(255,255,255,.1),transparent_60%)]"></div>
          <div className="relative mb-7 font-mono text-[0.6rem] tracking-[0.35em] uppercase text-(--fg-3)">— 010 · Start Here</div>
          <h2 className="relative mb-5 font-display font-normal text-[clamp(2.4rem,6vw,5rem)] leading-[0.95] tracking-[-0.035em] [font-variation-settings:'opsz'_144] [&_em]:font-light [&_em]:italic [&_em]:text-(--fg-2)">Be first on the network.<br/><em>Join the waitlist.</em></h2>
          <p className="relative mx-auto mb-9 max-w-[500px] text-base leading-[1.6] text-(--fg-2)">No credit card. No token. No permission. Phase C is live — Ed25519 identity, Merkle reputation and signed-receipt settlement work today, with zero blockchain required.</p>
          <div className="relative flex flex-wrap justify-center gap-2.5">
            <button className="relative inline-flex items-center gap-2.5 overflow-hidden isolate rounded-full bg-(--inv) px-6 py-3.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-(--inv-fg) [transition:background_.25s,color_.25s,border-color_.25s]" onClick={() => setShowWaitlist(true)}>
              <span className="relative z-[2]">Join Waitlist</span>
              <span className="relative z-[2]">↗</span>
            </button>
            <a className="relative inline-flex items-center gap-2.5 overflow-hidden isolate rounded-full border border-(--line-2) bg-[rgba(10,10,10,.5)] px-6 py-3.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-(--fg) backdrop-blur-md [transition:background_.25s,color_.25s,border-color_.25s] hover:border-(--fg) hover:bg-[rgba(20,20,20,.7)]" href="/PinaivuAI_Whitepaper.pdf" target="_blank" rel="noopener noreferrer">
              <span>Read Whitepaper</span>
            </a>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-(--line) px-(--content-pad) py-12 max-w-(--content-max) mx-auto">
        <div className="flex items-center gap-2.5 font-mono text-[0.72rem] font-medium tracking-[0.08em] uppercase">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/>
            <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
          </svg>
          Pinaivu AI
        </div>
        <div className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-(--fg-3)">The Inference Network · Est. 2026 · Licensed MIT</div>
        <ul className="flex list-none gap-5">
          <li><a href="#" className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-(--fg-3) transition-colors duration-300 hover:text-white">Docs</a></li>
          <li><a href="#" className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-(--fg-3) transition-colors duration-300 hover:text-white">GitHub</a></li>
          <li><a href="#" className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-(--fg-3) transition-colors duration-300 hover:text-white">Discord</a></li>
          <li><a href="#" className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-(--fg-3) transition-colors duration-300 hover:text-white">Twitter</a></li>
          <li><a href="/PinaivuAI_Whitepaper.pdf" target="_blank" rel="noopener noreferrer" className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-(--fg-3) transition-colors duration-300 hover:text-white">Whitepaper</a></li>
        </ul>
      </footer>
    </div>
  );
}

'use client';
import { useEffect } from 'react';

type TermLine = { c: string; d: number };

const TERM_BODIES: Record<string, TermLine[]> = {
  llm: [
    { c: '$ peer infer --model llama-3.1-405b \\', d: 60 },
    { c: '    --prompt "The future of decentralized AI is" \\', d: 40 },
    { c: '    --max-tokens 128 --stream', d: 40 },
    { c: '', d: 200 },
    { c: '<span class="k">[route]</span> <span class="o">Selected 16 nodes · eu-west × 8, us-east × 8</span>', d: 300 },
    { c: '<span class="k">[shard]</span> <span class="o">Model split: layers 0-25 · 26-50 · 51-75 · 76-100</span>', d: 260 },
    { c: '<span class="k">[shard]</span> <span class="o">Tensor parallel 16-way · NCCL-over-TCP</span>', d: 260 },
    { c: '<span class="k">[infer]</span> <span class="o">First token: 87ms · Throughput: 42 tok/s</span>', d: 300 },
    { c: '<span class="k">[stream]</span> <span class="p">› not about replacing centralised systems,</span>', d: 400 },
    { c: '           <span class="p">but about giving every developer the same</span>', d: 400 },
    { c: '           <span class="p">capabilities without permission or gatekeepers.</span>', d: 500 },
    { c: '<span class="k">[proof]</span> <span class="o">Ed25519 σ verified · π valid · offline</span>', d: 260 },
    { c: '<span class="k">[done]</span> <span class="s">128 tokens · 3.04s · 0.000384 PEER</span>', d: 0 },
  ],
  vision: [
    { c: '$ peer generate --model flux-1-pro \\', d: 60 },
    { c: '    --prompt "a quiet city at dawn, film grain" \\', d: 40 },
    { c: '    --size 1024x1024 --steps 4 --turbo', d: 40 },
    { c: '', d: 200 },
    { c: '<span class="k">[route]</span> <span class="o">Selected node eu-west-a100-17 · RTX 4090</span>', d: 260 },
    { c: '<span class="k">[diff]</span>  <span class="o">Step 1/4 · 0.5s</span>', d: 300 },
    { c: '<span class="k">[diff]</span>  <span class="o">Step 2/4 · 1.0s</span>', d: 300 },
    { c: '<span class="k">[diff]</span>  <span class="o">Step 3/4 · 1.5s</span>', d: 300 },
    { c: '<span class="k">[diff]</span>  <span class="o">Step 4/4 · 2.0s</span>', d: 300 },
    { c: '<span class="k">[out]</span>   <span class="o">1024×1024 PNG · 1.8 MB</span>', d: 260 },
    { c: '<span class="k">[proof]</span>  <span class="o">Ed25519 σ verified · π valid · offline</span>', d: 260 },
    { c: '<span class="k">[done]</span>  <span class="s">Total 2.1s · 0.004 PEER</span>', d: 0 },
  ],
  audio: [
    { c: '$ peer transcribe --model whisper-v3-large \\', d: 60 },
    { c: '    --input meeting_q2.mp3 --language auto \\', d: 40 },
    { c: '    --format json --stream', d: 40 },
    { c: '', d: 200 },
    { c: '<span class="k">[route]</span>   <span class="o">Selected node ap-east-14 · RTX 3090</span>', d: 260 },
    { c: '<span class="k">[detect]</span>  <span class="o">Language: English · 98.2% confidence</span>', d: 260 },
    { c: '<span class="k">[stt]</span>     <span class="o">Processing 47:12 of audio…</span>', d: 300 },
    { c: '<span class="k">[speed]</span>   <span class="o">52.3× realtime · 54.2s elapsed</span>', d: 300 },
    { c: '<span class="k">[out]</span>     <span class="o">transcript.json · 12,847 words</span>', d: 260 },
    { c: '<span class="k">[proof]</span>    <span class="o">Ed25519 σ verified · π valid · offline</span>', d: 260 },
    { c: '<span class="k">[done]</span>    <span class="s">Total 54.2s · 0.047 PEER</span>', d: 0 },
  ],
};

export function useModelTabs() {
  useEffect(() => {
    const tabs = document.querySelectorAll<HTMLElement>('#modelTabs .tab');
    const panels = document.querySelectorAll('.model-panel');
    const timers: Record<string, ReturnType<typeof setTimeout> | null> = {
      llm: null, vision: null, audio: null,
    };

    function runTerminal(kind: string) {
      const body = document.querySelector<HTMLElement>(`[data-term="${kind}"]`);
      if (!body) return;
      if (timers[kind]) { clearTimeout(timers[kind]!); timers[kind] = null; }
      body.innerHTML = '';

      const lines = TERM_BODIES[kind];
      let i = 0;

      function addLine() {
        if (i >= lines.length) {
          body!.innerHTML += '<div><span class="c">$</span> <span class="cursor-blink"></span></div>';
          body!.scrollTop = body!.scrollHeight;
          return;
        }
        const line = lines[i++];
        const div = document.createElement('div');
        div.innerHTML = line.c || '&nbsp;';
        body!.appendChild(div);
        body!.scrollTop = body!.scrollHeight;
        timers[kind] = setTimeout(addLine, line.d || 60);
      }

      addLine();
    }

    function activate(kind: string) {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === kind));
      panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${kind}`));
      runTerminal(kind);
    }

    tabs.forEach((t) => t.addEventListener('click', () => activate(t.dataset.tab!)));

    const modelsSec = document.getElementById('models');
    let sectIO: IntersectionObserver | null = null;
    if (modelsSec) {
      sectIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) { runTerminal('llm'); sectIO!.unobserve(e.target); }
          });
        },
        { threshold: 0.25 }
      );
      sectIO.observe(modelsSec);
    }

    return () => {
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      sectIO?.disconnect();
    };
  }, []);
}

'use client';
import { useEffect } from 'react';

export function useWordReveal() {
  useEffect(() => {
    const titles = document.querySelectorAll<HTMLElement>('.sec-title');

    titles.forEach((el) => {
      if (el.dataset.split) return;
      const html = el.innerHTML;
      const parts = html.split(/(<[^>]+>|\s+)/).filter((p) => p.length);
      el.innerHTML = parts
        .map((p) => {
          if (p.startsWith('<') || /^\s+$/.test(p)) return p;
          return `<span class="sec-word"><span>${p}</span></span>`;
        })
        .join(' ');
      el.dataset.split = '1';
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const words = entry.target.querySelectorAll('.sec-word > span');
          words.forEach((w, i) => {
            (w as HTMLElement).style.transitionDelay = i * 0.06 + 's';
            requestAnimationFrame(() => w.classList.add('in'));
          });
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );

    titles.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
}

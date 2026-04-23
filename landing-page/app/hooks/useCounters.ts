'use client';
import { useEffect } from 'react';

export function useCounters() {
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-count]');

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const target = parseFloat(el.dataset.count!);
          const isFloat = el.dataset.float === '1';
          const dur = 1800;
          const start = performance.now();

          const step = (now: number) => {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            const v = target * eased;
            el.textContent = isFloat ? v.toFixed(1) : Math.floor(v).toLocaleString();
            if (p < 1) requestAnimationFrame(step);
          };

          requestAnimationFrame(step);
          io.unobserve(el);
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -10% 0px' }
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
}

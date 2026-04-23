'use client';
import { useEffect } from 'react';

export function useScrollProgress() {
  useEffect(() => {
    const bar = document.getElementById('progBar') as HTMLElement | null;
    const nav = document.getElementById('nav');
    if (!bar) return;

    const tick = () => {
      const h = document.documentElement;
      const ratio = h.scrollTop / (h.scrollHeight - h.clientHeight);
      bar.style.transform = `scaleX(${isNaN(ratio) ? 0 : ratio})`;
      nav?.classList.toggle('scrolled', h.scrollTop > 40);
    };

    window.addEventListener('scroll', tick, { passive: true });
    tick();
    return () => window.removeEventListener('scroll', tick);
  }, []);
}

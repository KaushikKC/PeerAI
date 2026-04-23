'use client';
import { useEffect } from 'react';

export function useHeroGradient() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>('.hero');
    const grad = document.getElementById('heroGradient') as HTMLElement | null;
    if (!hero || !grad) return;

    let targetX = 50, targetY = 50, curX = 50, curY = 50;
    let raf: number | null = null;

    const tick = () => {
      curX += (targetX - curX) * 0.12;
      curY += (targetY - curY) * 0.12;
      grad.style.setProperty('--mx', curX.toFixed(2) + '%');
      grad.style.setProperty('--my', curY.toFixed(2) + '%');
      if (Math.abs(targetX - curX) > 0.1 || Math.abs(targetY - curY) > 0.1) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    };

    const onMove = (e: MouseEvent) => {
      const r = hero.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width) * 100;
      targetY = ((e.clientY - r.top) / r.height) * 100;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onLeave = () => {
      targetX = 50; targetY = 50;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    hero.addEventListener('mousemove', onMove);
    hero.addEventListener('mouseleave', onLeave);
    grad.style.setProperty('--mx', '50%');
    grad.style.setProperty('--my', '50%');

    return () => {
      hero.removeEventListener('mousemove', onMove);
      hero.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

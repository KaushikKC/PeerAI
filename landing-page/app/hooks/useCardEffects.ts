'use client';
import { useEffect } from 'react';

export function useCardEffects() {
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('[data-card]');

    type Handlers = { onMove: (e: MouseEvent) => void; onLeave: () => void };
    const attached: Array<{ card: HTMLElement } & Handlers> = [];

    cards.forEach((card) => {
      const onMove = (e: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        const px = ((e.clientX - rect.left) / rect.width) * 100;
        const py = ((e.clientY - rect.top) / rect.height) * 100;

        card.style.transform = `perspective(1000px) rotateX(${-y * 3}deg) rotateY(${x * 3}deg) translateZ(0)`;
        card.style.backgroundImage = `radial-gradient(circle 200px at ${px}% ${py}%, rgba(255,255,255,.045), transparent 70%)`;

        const inner = card.firstElementChild as HTMLElement | null;
        if (inner) {
          inner.style.transform = `translate(${x * 4}px, ${y * 4}px)`;
          inner.style.transition = 'transform .2s ease-out';
        }
      };

      const onLeave = () => {
        card.style.transform = '';
        card.style.backgroundImage = '';
        const inner = card.firstElementChild as HTMLElement | null;
        if (inner) {
          inner.style.transform = '';
          inner.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1)';
        }
      };

      card.addEventListener('mousemove', onMove);
      card.addEventListener('mouseleave', onLeave);
      attached.push({ card, onMove, onLeave });
    });

    return () => {
      attached.forEach(({ card, onMove, onLeave }) => {
        card.removeEventListener('mousemove', onMove);
        card.removeEventListener('mouseleave', onLeave);
      });
    };
  }, []);
}

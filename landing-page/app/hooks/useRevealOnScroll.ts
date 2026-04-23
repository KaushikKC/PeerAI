'use client';
import { useEffect } from 'react';

export function useRevealOnScroll() {
  useEffect(() => {
    const targets = document.querySelectorAll(
      '.reveal, .stat, .flow, .manifesto, .hw, #hwGrid'
    );
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
}

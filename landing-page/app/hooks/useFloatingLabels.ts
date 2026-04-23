'use client';
import { useEffect } from 'react';

export function useFloatingLabels() {
  useEffect(() => {
    const floats = document.querySelectorAll<HTMLElement>(
      '.hero-marker, [data-float]'
    );
    floats.forEach((el, i) => {
      el.style.animation = `float-sub ${5 + i * 0.4}s ease-in-out ${i * 0.2}s infinite alternate`;
    });
  }, []);
}

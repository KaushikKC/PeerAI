'use client';
import { useEffect } from 'react';

export function useTicker() {
  useEffect(() => {
    const ticker = document.getElementById('ticker');
    if (!ticker || ticker.dataset.duplicated) return;
    ticker.innerHTML += ticker.innerHTML;
    ticker.dataset.duplicated = '1';
  }, []);
}

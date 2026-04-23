'use client';
import { useEffect } from 'react';

export function useFlowLines() {
  useEffect(() => {
    function positionLines() {
      const stage = document.getElementById('flowStage');
      if (!stage) return;
      stage.querySelectorAll('.flow-line').forEach((l) => l.remove());
      const steps = stage.querySelectorAll('.flow-step');
      if (steps.length < 2) return;
      const stageRect = stage.getBoundingClientRect();

      for (let i = 0; i < steps.length - 1; i++) {
        const nodeA = steps[i].querySelector('.flow-node');
        const nodeB = steps[i + 1].querySelector('.flow-node');
        if (!nodeA || !nodeB) continue;
        const a = nodeA.getBoundingClientRect();
        const b = nodeB.getBoundingClientRect();
        if (Math.abs(a.top - b.top) > 30) continue;
        const line = document.createElement('div');
        line.className = 'flow-line';
        line.style.left = `${a.right - stageRect.left - 10}px`;
        line.style.width = `${b.left - a.right + 20}px`;
        line.style.top = `${a.top + a.height / 2 - stageRect.top}px`;
        stage.appendChild(line);
      }
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(positionLines, 80); };

    const initTimer = setTimeout(positionLines, 200);
    window.addEventListener('resize', onResize);

    const flow = document.querySelector('.flow');
    let flowIO: IntersectionObserver | null = null;
    if (flow) {
      flowIO = new IntersectionObserver(
        (entries) => { entries.forEach((e) => { if (e.isIntersecting) setTimeout(positionLines, 100); }); },
        { threshold: 0.1 }
      );
      flowIO.observe(flow);
    }

    return () => {
      clearTimeout(initTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      flowIO?.disconnect();
    };
  }, []);
}

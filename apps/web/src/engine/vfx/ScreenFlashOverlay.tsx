'use client';

import { useRef } from 'react';
import type { ScreenEffects } from './ScreenEffects';

interface ScreenFlashOverlayProps {
  screenEffects: ScreenEffects;
}

export function ScreenFlashOverlay({ screenEffects }: ScreenFlashOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);

  if (typeof window !== 'undefined') {
    const update = () => {
      if (!ref.current) {
        requestAnimationFrame(update);
        return;
      }
      const state = screenEffects.state;

      if (state.flash) {
        const progress = state.flash.timer / state.flash.duration;
        ref.current.style.backgroundColor = state.flash.color;
        ref.current.style.opacity = String(state.flash.opacity * progress);
        ref.current.style.display = 'block';
      } else {
        ref.current.style.display = 'none';
      }

      const tint = state.colorTint;
      if (tint.a > 0.01) {
        ref.current.style.display = 'block';
        ref.current.style.backgroundColor = `rgba(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)}, ${tint.a})`;
      }

      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  return (
    <div
      ref={ref}
      className="fixed inset-0 pointer-events-none z-40"
      style={{ display: 'none', mixBlendMode: 'screen' }}
    />
  );
}

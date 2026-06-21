'use client';

import { useEffect, useRef } from 'react';
import { Action, getInputSystem } from './InputSystem';

interface TouchButtonProps {
  action: Action;
  label: string;
  className?: string;
}

function TouchButton({ action, label, className = '' }: TouchButtonProps) {
  const input = getInputSystem();

  return (
    <button
      className={`select-none touch-none rounded-full font-bold text-white active:scale-90 transition-transform ${className}`}
      onTouchStart={(e) => {
        e.preventDefault();
        input.triggerAction(action);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        input.releaseAction(action);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export function TouchControls() {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const input = getInputSystem();
  const touchIdRef = useRef<number | null>(null);

  useEffect(() => {
    const stick = stickRef.current;
    if (!stick) return;

    const radius = 50;

    const handleMove = (clientX: number, clientY: number) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = -(clientY - cy);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
      }
      const nx = dx / radius;
      const ny = dy / radius;
      input.setStick(nx, ny);
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${dx}px, ${-dy}px)`;
      }
    };

    const reset = () => {
      input.setStick(0, 0);
      touchIdRef.current = null;
      if (knobRef.current) {
        knobRef.current.style.transform = 'translate(0,0)';
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      touchIdRef.current = t.identifier;
      handleMove(t.clientX, t.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          handleMove(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
          break;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          reset();
          break;
        }
      }
    };

    stick.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      stick.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [input]);

  return (
    <div className="fixed inset-0 pointer-events-none z-50 md:hidden">
      {/* Virtual Joystick — bottom left */}
      <div
        ref={stickRef}
        className="pointer-events-auto absolute bottom-20 left-8 w-32 h-32 rounded-full bg-white/10 border border-white/20 flex items-center justify-center"
      >
        <div
          ref={knobRef}
          className="w-14 h-14 rounded-full bg-white/30 border border-white/40 transition-none"
        />
      </div>

      {/* Action Buttons — bottom right */}
      <div className="pointer-events-auto absolute bottom-16 right-6 flex flex-col items-center gap-2">
        <TouchButton
          action={Action.HeavyAttack}
          label="H"
          className="w-14 h-14 bg-orange-600/70 text-lg"
        />
        <div className="flex gap-2">
          <TouchButton
            action={Action.Block}
            label="B"
            className="w-12 h-12 bg-blue-600/70 text-sm"
          />
          <TouchButton
            action={Action.LightAttack}
            label="A"
            className="w-16 h-16 bg-red-600/70 text-xl"
          />
          <TouchButton
            action={Action.Dodge}
            label="D"
            className="w-12 h-12 bg-green-600/70 text-sm"
          />
        </div>
        <TouchButton
          action={Action.Special}
          label="S"
          className="w-14 h-14 bg-purple-600/70 text-lg"
        />
      </div>

      {/* Lock-on — top right */}
      <TouchButton
        action={Action.LockOn}
        label="🎯"
        className="pointer-events-auto absolute top-20 right-6 w-10 h-10 bg-white/10 text-sm"
      />
    </div>
  );
}

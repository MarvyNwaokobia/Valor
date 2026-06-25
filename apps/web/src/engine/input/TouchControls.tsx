'use client';

import { useEffect, useRef } from 'react';
import { Crosshair, Wind, type LucideIcon } from 'lucide-react';
import { Action, getInputSystem } from './InputSystem';

interface TouchButtonProps {
  action: Action;
  label: string;
  icon?: LucideIcon;
  className?: string;
}

function TouchButton({ action, label, icon: Icon, className = '' }: TouchButtonProps) {
  const input = getInputSystem();

  return (
    <button
      className={`select-none touch-none rounded-full font-bold text-white active:scale-90 active:brightness-150 transition-all flex flex-col items-center justify-center ${className}`}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
        input.triggerAction(action);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        input.releaseAction(action);
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        input.triggerAction(action);
      }}
      onMouseUp={(e) => {
        e.preventDefault();
        input.releaseAction(action);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {Icon && <Icon size={20} strokeWidth={2.5} className="leading-none" />}
      <span className="text-[9px] uppercase tracking-wide leading-none mt-0.5">{label}</span>
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
      input.setStick(dx / radius, dy / radius);
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${dx}px, ${-dy}px)`;
      }
    };

    const reset = () => {
      input.setStick(0, 0);
      touchIdRef.current = null;
      if (knobRef.current) knobRef.current.style.transform = 'translate(0,0)';
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
        className="pointer-events-auto absolute bottom-20 left-6 w-28 h-28 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center"
      >
        <div
          ref={knobRef}
          className="w-12 h-12 rounded-full bg-white/30 border-2 border-white/50 transition-none"
        />
      </div>
      <div className="absolute bottom-8 left-10 text-[10px] text-white/30 uppercase tracking-wider">
        Move
      </div>

      {/* Shooter controls — bottom right: hold FIRE (auto-fires on the gun's
          cadence) + DODGE for i-frames. */}
      <div className="pointer-events-auto absolute bottom-16 right-6 flex items-end gap-3">
        <TouchButton
          action={Action.Dodge}
          icon={Wind}
          label="Dodge"
          className="w-16 h-16 bg-green-600/80 border border-green-400/40 mb-1"
        />
        <TouchButton
          action={Action.Fire}
          icon={Crosshair}
          label="Fire"
          className="w-24 h-24 bg-red-600/85 border-2 border-red-400/50"
        />
      </div>
    </div>
  );
}

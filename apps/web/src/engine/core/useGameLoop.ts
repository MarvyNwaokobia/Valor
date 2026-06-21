import { useEffect, useRef } from 'react';
import { GameLoop, getGameLoop, type UpdateCallback } from './GameLoop';

export function useGameLoop(
  fixedUpdate?: UpdateCallback,
  frameUpdate?: UpdateCallback
): GameLoop {
  const loop = useRef(getGameLoop()).current;
  const fixedRef = useRef(fixedUpdate);
  const frameRef = useRef(frameUpdate);

  fixedRef.current = fixedUpdate;
  frameRef.current = frameUpdate;

  useEffect(() => {
    loop.onFixedUpdate((dt, t) => fixedRef.current?.(dt, t));
    loop.onFrameUpdate((dt, t) => frameRef.current?.(dt, t));
    loop.start();
    return () => loop.stop();
  }, [loop]);

  return loop;
}

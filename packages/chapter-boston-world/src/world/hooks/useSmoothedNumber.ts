import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// Eases a numeric UI value toward its target over durationMs (cubic ease-out).
// durationMs <= 0 snaps immediately (reduced-motion path).
export function useSmoothedNumber(target: number, durationMs: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (durationMs <= 0) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const linear = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - linear, 3);
      current.current = THREE.MathUtils.lerp(from, target, eased);
      setValue(current.current);
      if (linear < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  durationMs?: number;
  className?: string;
};

const formatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/**
 * CSS/runtime-light adaptation of Motion Primitives' AnimatedNumber.
 * Animates integer record counts only; caller retains ownership of the value.
 */
export default function MotionAnimatedNumber({ value, durationMs = 520, className }: Props) {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  const [displayValue, setDisplayValue] = useState(safeValue);
  const currentValue = useRef(safeValue);

  useEffect(() => {
    const target = safeValue;
    const from = currentValue.current;
    if (from === target) return;

    const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (motionPreference?.matches || durationMs <= 0 || typeof window.requestAnimationFrame !== "function") {
      currentValue.current = target;
      setDisplayValue(target);
      return;
    }

    let frame = 0;
    let startTime: number | null = null;
    let cancelled = false;

    const finishImmediately = () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      currentValue.current = target;
      setDisplayValue(target);
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      if (event.matches) finishImmediately();
    };
    motionPreference?.addEventListener?.("change", onMotionPreferenceChange);

    const tick = (timestamp: number) => {
      if (cancelled) return;
      if (startTime === null) startTime = timestamp;
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (target - from) * eased);
      currentValue.current = next;
      setDisplayValue(next);

      if (progress < 1) frame = window.requestAnimationFrame(tick);
      else currentValue.current = target;
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      motionPreference?.removeEventListener?.("change", onMotionPreferenceChange);
    };
  }, [safeValue, durationMs]);

  return (
    <span
      className={["ax-motion-number", className].filter(Boolean).join(" ")}
      aria-label={formatter.format(safeValue)}
    >
      {formatter.format(displayValue)}
    </span>
  );
}

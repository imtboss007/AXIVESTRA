/**
 * Adapted from Magic UI Border Beam.
 * Upstream: https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/border-beam.tsx
 * Copyright (c) Magic UI — MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { motion, useReducedMotion, type MotionStyle, type Transition } from "motion/react";

type BorderBeamProps = {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  transition?: Transition;
  reverse?: boolean;
  initialOffset?: number;
  borderWidth?: number;
};

export function BorderBeam({
  size = 56,
  duration = 7,
  delay = 0,
  colorFrom = "#35bfd0",
  colorTo = "#7be2ba",
  transition,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1
}: BorderBeamProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <div
      className="ax-magic-border-beam"
      aria-hidden="true"
      style={{ "--ax-beam-border-width": borderWidth + "px" } as React.CSSProperties}
    >
      <motion.div
        style={{
          position: "absolute",
          aspectRatio: "1 / 1",
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`
        } as MotionStyle}
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{
          offsetDistance: reverse
            ? [`${100 - initialOffset}%`, `-${initialOffset}%`]
            : [`${initialOffset}%`, `${100 + initialOffset}%`]
        }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration,
          delay: -delay,
          ...transition
        }}
      />
    </div>
  );
}

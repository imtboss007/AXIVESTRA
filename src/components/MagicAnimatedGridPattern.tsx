import { useId } from "react";

/**
 * CSS-only adaptation of Magic UI's Animated Grid Pattern.
 * Keeps the grid effect lightweight for AXIVESTRA's React 18 / Vite 6 stack.
 */
export default function MagicAnimatedGridPattern() {
  const patternId = `ax-magic-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const squares = Array.from({ length: 32 }, (_, index) => ({
    x: ((index * 7 + 3) % 24) * 40 + 1,
    y: ((index * 5 + 2) % 9) * 40 + 1,
    delay: `${(index % 12) * 0.19}s`
  }));

  return (
    <svg
      className="ax-magic-grid-pattern"
      viewBox="0 0 960 360"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={patternId} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M.5 40V.5H40" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity=".24" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      {squares.map((square, index) => (
        <rect
          key={index}
          className="ax-magic-grid-pattern__square"
          x={square.x}
          y={square.y}
          width="38"
          height="38"
          rx="3"
          style={{ animationDelay: square.delay }}
        />
      ))}
    </svg>
  );
}

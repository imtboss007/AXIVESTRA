import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

/**
 * CSS-only adaptation of Unlumen UI's Glow Button.
 * Keeps the native button contract and leaves all motion in the scoped theme.
 */
export default function UnlumenGlowButton({ className = "", children, ...props }: Props) {
  return (
    <button
      {...props}
      className={["ax-unlumen-glow-button", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

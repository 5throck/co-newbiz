import { type ReactNode } from "react";

type Tone = "green" | "amber" | "red" | "neutral" | "accent";

const toneClasses: Record<Tone, string> = {
  green: "grade-green",
  amber: "grade-amber",
  red: "grade-red",
  neutral: "grade-incomplete",
  accent: "bg-[color:var(--accent)] text-[color:var(--bg)]",
};

interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", icon, children, className = "" }: BadgeProps) {
  return (
    <span className={`grade-badge ${toneClasses[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

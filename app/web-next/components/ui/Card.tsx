import { type ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = "", hover = true }: CardProps) {
  return (
    <div className={`card ${hover ? "" : "hover:transform-none hover:shadow-none"} ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, action, className = "" }: CardHeaderProps) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-4 ${className}`}>
      <h3 className="text-label m-0">{title}</h3>
      {action}
    </div>
  );
}

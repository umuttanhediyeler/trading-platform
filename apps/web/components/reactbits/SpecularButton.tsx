"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * ReactBits-style "Specular" button: a bright specular highlight tracks the
 * cursor across the surface, plus a slow sheen sweep while idle. Renders a
 * Next.js Link when `href` is given, otherwise a plain button.
 */
export function SpecularButton({
  children,
  className,
  href,
  variant = "primary",
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  href?: string;
  variant?: "primary" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [hover, setHover] = useState(false);

  const surface =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : "border border-border/80 bg-card/40 text-foreground backdrop-blur hover:border-foreground/30";

  const specular =
    variant === "primary"
      ? "rgba(255,255,255,0.45)"
      : "hsl(var(--primary) / 0.35)";

  const inner = (
    <span
      ref={ref}
      onMouseMove={(e) => {
        if (disabled) return;
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        setPos({
          x: ((e.clientX - rect.left) / rect.width) * 100,
          y: ((e.clientY - rect.top) / rect.height) * 100,
        });
      }}
      onMouseEnter={() => {
        if (!disabled) setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full px-6 py-3 text-sm font-medium tracking-tight transition-transform duration-200 active:scale-[0.98]",
        surface,
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      {/* Cursor-tracking specular highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: hover ? 1 : 0,
          background: `radial-gradient(120px circle at ${pos.x}% ${pos.y}%, ${specular}, transparent 70%)`,
        }}
      />
      {/* Idle sheen sweep */}
      <span
        aria-hidden
        className="animate-specular-sweep pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.18) 50%, transparent 60%)",
          backgroundSize: "250% 100%",
        }}
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn("inline-flex", disabled && "pointer-events-none")}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex"
    >
      {inner}
    </button>
  );
}

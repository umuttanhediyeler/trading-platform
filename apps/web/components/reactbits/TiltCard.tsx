"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * ReactBits-style 3D tilt card: the card subtly rotates toward the cursor.
 * Perspective transform only — cheap and battery friendly.
 */
export function TiltCard({
  children,
  className,
  maxTilt = 6,
}: {
  children: React.ReactNode;
  className?: string;
  /** Maximum rotation in degrees. */
  maxTilt?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState("");

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        setTransform(
          `perspective(900px) rotateX(${(-py * maxTilt).toFixed(2)}deg) rotateY(${(px * maxTilt).toFixed(2)}deg)`,
        );
      }}
      onMouseLeave={() => setTransform("")}
      className={cn("transition-transform duration-200 ease-out will-change-transform", className)}
      style={{ transform }}
    >
      {children}
    </div>
  );
}

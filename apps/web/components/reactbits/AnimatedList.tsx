"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FadeIn } from "./FadeIn";

type AnimatedListProps = {
  children: ReactNode;
  /** Approximate number of rows/cards visible before scrolling (~10–15). */
  maxVisible?: number;
  /** Tailwind height per item in px (row ~52, card ~120). */
  itemHeight?: number;
  className?: string;
  innerClassName?: string;
  fade?: boolean;
};

export function AnimatedList({
  children,
  maxVisible = 12,
  itemHeight = 52,
  className,
  innerClassName,
  fade = true,
}: AnimatedListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const maxHeight = maxVisible * itemHeight;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function update() {
      const overflow = el.scrollHeight > el.clientHeight + 4;
      setCanScroll(overflow);
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [children, maxHeight]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scrollRef}
        className={cn(
          "overflow-y-auto overscroll-contain scroll-smooth [-webkit-overflow-scrolling:touch]",
          innerClassName,
        )}
        style={{ maxHeight }}
      >
        {children}
      </div>
      {fade && canScroll && !atBottom ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent"
        />
      ) : null}
      {canScroll && !atBottom ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground/80">
          Kaydır ↓
        </p>
      ) : null}
    </div>
  );
}

export function AnimatedListItems({
  items,
  renderItem,
  maxVisible = 12,
  itemHeight = 52,
  className,
  staggerMs = 40,
}: {
  items: readonly unknown[];
  renderItem: (item: unknown, index: number) => ReactNode;
  maxVisible?: number;
  itemHeight?: number;
  className?: string;
  staggerMs?: number;
}) {
  return (
    <AnimatedList maxVisible={maxVisible} itemHeight={itemHeight} className={className}>
      <div className="divide-y divide-border/50">
        {items.map((item, index) => (
          <FadeIn key={index} delay={Math.min(index * staggerMs, 320)}>
            {renderItem(item, index)}
          </FadeIn>
        ))}
      </div>
    </AnimatedList>
  );
}

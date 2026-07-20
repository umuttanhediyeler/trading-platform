"use client";

import { useEffect, useState } from "react";
import type { ChartApi } from "./PriceChart";
import type { ChartPoint, Drawing, DrawingTool } from "@/lib/chart-tools";
import { pointsNeeded } from "@/lib/chart-tools";
import { cn } from "@/lib/utils";

/**
 * SVG overlay that lets the user draw trend lines, horizontals, rays,
 * rectangles and Fibonacci retracements on top of a lightweight-charts pane.
 * Coordinates are stored in logical time/price space so they survive pan/zoom.
 */
export function DrawingOverlay({
  chartApi,
  tool,
  drawings,
  draftColor,
  onComplete,
  onCancelDraft,
}: {
  chartApi: ChartApi | null;
  tool: DrawingTool;
  drawings: Drawing[];
  draftColor: string;
  onComplete: (drawing: Omit<Drawing, "id">) => void;
  onCancelDraft: () => void;
}) {
  const [draft, setDraft] = useState<ChartPoint[]>([]);
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!chartApi) return;
    return chartApi.subscribeViewChange(() => setTick((n) => n + 1));
  }, [chartApi]);

  useEffect(() => {
    setDraft([]);
    setHover(null);
  }, [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft([]);
        setHover(null);
        onCancelDraft();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancelDraft]);

  const active = tool !== "cursor";

  function toPixel(p: ChartPoint) {
    // tick used to force re-render after pan/zoom
    void tick;
    return chartApi?.pixelFromPoint(p.time, p.price) ?? null;
  }

  function handleClick(e: React.MouseEvent) {
    if (!active || !chartApi) return;
    e.preventDefault();
    e.stopPropagation();
    const point = chartApi.pointFromEvent(e.clientX, e.clientY);
    if (!point) return;

    const needed = pointsNeeded(tool);
    const next = [...draft, point];
    if (next.length >= needed) {
      onComplete({
        type: tool as Drawing["type"],
        points: next.slice(0, needed),
        color: draftColor,
      });
      setDraft([]);
      setHover(null);
    } else {
      setDraft(next);
    }
  }

  function handleMove(e: React.MouseEvent) {
    if (!active || !chartApi || draft.length === 0) {
      setHover(null);
      return;
    }
    const point = chartApi.pointFromEvent(e.clientX, e.clientY);
    setHover(point);
  }

  const previewPoints =
    draft.length > 0 && hover ? [...draft, hover] : draft;

  return (
    <div
      className={cn(
        "absolute inset-0 z-10",
        active ? "cursor-crosshair" : "pointer-events-none",
      )}
      onClick={handleClick}
      onMouseMove={handleMove}
      onContextMenu={(e) => {
        if (!active) return;
        e.preventDefault();
        setDraft([]);
        setHover(null);
      }}
    >
      <svg className="h-full w-full overflow-visible">
        {drawings.map((d) => (
          <DrawingShape key={d.id} drawing={d} toPixel={toPixel} />
        ))}
        {previewPoints.length > 0 && tool !== "cursor" ? (
          <DrawingShape
            drawing={{
              id: "draft",
              type: tool as Drawing["type"],
              points: previewPoints,
              color: draftColor,
            }}
            toPixel={toPixel}
            dashed
          />
        ) : null}
      </svg>
    </div>
  );
}

function DrawingShape({
  drawing,
  toPixel,
  dashed = false,
}: {
  drawing: Drawing;
  toPixel: (p: ChartPoint) => { x: number; y: number } | null;
  dashed?: boolean;
}) {
  const stroke = drawing.color;
  const dash = dashed ? "6 4" : undefined;

  if (drawing.type === "hline") {
    const p = toPixel(drawing.points[0]);
    if (!p) return null;
    return (
      <g>
        <line
          x1={-50}
          y1={p.y}
          x2={5000}
          y2={p.y}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray={dash}
        />
        <text x={8} y={p.y - 6} fill={stroke} fontSize={10} fontFamily="monospace">
          {drawing.points[0].price.toFixed(2)}
        </text>
      </g>
    );
  }

  if (drawing.type === "trend" || drawing.type === "ray") {
    const a = toPixel(drawing.points[0]);
    const b = drawing.points[1] ? toPixel(drawing.points[1]) : null;
    if (!a || !b) {
      return a ? <circle cx={a.x} cy={a.y} r={3} fill={stroke} /> : null;
    }
    let x2 = b.x;
    let y2 = b.y;
    if (drawing.type === "ray") {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const scale = 4000 / Math.max(Math.hypot(dx, dy), 1);
      x2 = a.x + dx * scale;
      y2 = a.y + dy * scale;
    }
    return (
      <g>
        <line
          x1={a.x}
          y1={a.y}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray={dash}
        />
        <circle cx={a.x} cy={a.y} r={3} fill={stroke} />
        <circle cx={b.x} cy={b.y} r={3} fill={stroke} />
      </g>
    );
  }

  if (drawing.type === "rect") {
    const a = toPixel(drawing.points[0]);
    const b = drawing.points[1] ? toPixel(drawing.points[1]) : null;
    if (!a || !b) {
      return a ? <circle cx={a.x} cy={a.y} r={3} fill={stroke} /> : null;
    }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    return (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={`${stroke}22`}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={dash}
      />
    );
  }

  if (drawing.type === "fib") {
    const a = toPixel(drawing.points[0]);
    const b = drawing.points[1] ? toPixel(drawing.points[1]) : null;
    if (!a || !b) {
      return a ? <circle cx={a.x} cy={a.y} r={3} fill={stroke} /> : null;
    }
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    return (
      <g>
        {levels.map((level) => {
          const y = a.y + (b.y - a.y) * level;
          const price =
            drawing.points[0].price +
            (drawing.points[1].price - drawing.points[0].price) * level;
          return (
            <g key={level}>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={stroke}
                strokeWidth={1}
                strokeDasharray={dash ?? (level === 0 || level === 1 ? undefined : "4 3")}
                opacity={0.85}
              />
              <text
                x={x2 + 4}
                y={y + 3}
                fill={stroke}
                fontSize={9}
                fontFamily="monospace"
              >
                {(level * 100).toFixed(1)}% · {price.toFixed(2)}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  return null;
}

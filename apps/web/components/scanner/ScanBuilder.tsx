"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Play, Plus, Sparkles } from "lucide-react";
import {
  COMPARISON_OPERATORS,
  SCAN_FIELD_DEFINITIONS,
  type ScanFilter,
  type ScanFilterGroup,
  type ScanTemplate,
} from "@trading-platform/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterChip } from "./FilterChip";
import type { FilterDSL, PlanTier, ScanCondition } from "@/lib/types";
import { canUseScanFilterCount } from "@/lib/entitlements";
import { Badge } from "@/components/ui/badge";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { cn } from "@/lib/utils";

const FIELD_HINTS: Record<string, string> = {
  volume_ratio: "Normal hacmin kaç katı işlem gördüğünü filtreler. 2–3× güçlü hareketleri bulur.",
  gap_percent: "Önceki kapanışa göre açılış farkı. Pozitif değer yukarı gap demektir.",
  rsi_14: "0–100 momentum ölçümü. 30 altı aşırı satım, 70 üstü aşırı alım kabul edilir.",
  price_vs_vwap: "Fiyatın hacim ağırlıklı ortalamaya göre yüzde konumunu ölçer.",
};

function countConditions(group: ScanFilterGroup): number {
  return group.conditions.reduce(
    (total, node) => total + ("field" in node ? 1 : countConditions(node)),
    0,
  );
}

function removeNode(group: ScanFilterGroup, path: number[]): ScanFilterGroup {
  const [index, ...rest] = path;
  if (rest.length === 0) {
    return { ...group, conditions: group.conditions.filter((_, i) => i !== index) };
  }
  return {
    ...group,
    conditions: group.conditions.map((node, i) =>
      i === index && !("field" in node) ? removeNode(node, rest) : node,
    ),
  };
}

function FilterTree({
  group,
  path = [],
  onRemove,
}: {
  group: ScanFilterGroup;
  path?: number[];
  onRemove: (path: number[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-2">
      <Badge variant="outline">{group.operator}</Badge>
      <div className="flex flex-wrap gap-2">
        {group.conditions.map((node, index) =>
          "field" in node ? (
            <FilterChip
              key={`${path.join(".")}-${index}`}
              condition={node}
              onRemove={() => onRemove([...path, index])}
            />
          ) : (
            <FilterTree
              key={`${path.join(".")}-${index}`}
              group={node}
              path={[...path, index]}
              onRemove={onRemove}
            />
          ),
        )}
      </div>
    </div>
  );
}

export function ScanBuilder({
  initial,
  planTier = "free",
  onChange,
  onRun,
  templates = [],
  disabled = false,
}: {
  initial?: FilterDSL;
  planTier?: PlanTier;
  onChange?: (dsl: FilterDSL) => void;
  onRun?: (dsl: FilterDSL) => void;
  templates?: ScanTemplate[];
  disabled?: boolean;
}) {
  const [dsl, setDsl] = useState<ScanFilter>(
    initial ?? {
      operator: "AND",
      conditions: [
      { field: "volume_ratio", op: ">", value: 3 },
      ],
    },
  );
  const [field, setField] = useState<ScanCondition["field"]>("volume_ratio");
  const [op, setOp] = useState<ScanCondition["op"]>(">");
  const [value, setValue] = useState("3");

  useEffect(() => {
    if (initial) setDsl(structuredClone(initial));
  }, [initial]);

  const conditionCount = useMemo(() => countConditions(dsl), [dsl]);
  const allowed = canUseScanFilterCount(planTier, conditionCount);
  const nextAllowed = canUseScanFilterCount(planTier, conditionCount + 1);

  function update(nextDsl: FilterDSL) {
    setDsl(nextDsl);
    onChange?.(nextDsl);
  }

  function addCondition() {
    if (!nextAllowed) return;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    update({ ...dsl, conditions: [...dsl.conditions, { field, op, value: parsed }] });
  }

  function removeAt(path: number[]) {
    update(removeNode(dsl, path));
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template || !canUseScanFilterCount(planTier, countConditions(template.filterDSL))) return;
    update(structuredClone(template.filterDSL));
  }

  return (
    <Card className="overflow-hidden rounded-3xl bg-card/80 backdrop-blur">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Taramanı oluştur</CardTitle>
            <CardDescription>
              Hazır bir fikirle başlayın veya koşulları adım adım ekleyin.
            </CardDescription>
          </div>
          <Badge variant={allowed ? "secondary" : "warning"}>
            {conditionCount} filtre
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Hızlı başlangıç
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {templates.slice(0, 3).map((template, index) => {
              const templateAllowed = canUseScanFilterCount(
                planTier,
                countConditions(template.filterDSL),
              );
              return (
                <SpotlightCard
                  key={template.id}
                  className={cn(
                    "rounded-2xl border bg-background/45",
                    !templateAllowed && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => applyTemplate(template.id)}
                    disabled={!templateAllowed}
                    className="group flex h-full w-full flex-col p-4 text-left"
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        ( {index + 1} )
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                    <p className="mt-4 font-display text-base font-semibold tracking-tight">
                      {template.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {template.description}
                    </p>
                  </button>
                </SpotlightCard>
              );
            })}
          </div>
          {templates.length > 3 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {templates.slice(3).map((template) => (
                <Button
                  key={template.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyTemplate(template.id)}
                  disabled={
                    !canUseScanFilterCount(planTier, countConditions(template.filterDSL))
                  }
                >
                  {template.name}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Koşul ekle</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {FIELD_HINTS[field]}
              </p>
            </div>
            <Badge variant="outline">Adım 2</Badge>
          </div>
          <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Mantık</p>
            <Select
              value={dsl.operator}
              onChange={(e) => {
                const nextOp = e.target.value as "AND" | "OR";
                update({ ...dsl, operator: nextOp });
              }}
              className="w-24"
            >
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Gösterge</p>
            <Select value={field} onChange={(e) => setField(e.target.value)} className="w-40">
              {SCAN_FIELD_DEFINITIONS.map((f) => (
                <option key={f.field} value={f.field}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Koşul</p>
            <Select
              value={op}
              onChange={(e) => setOp(e.target.value as ScanCondition["op"])}
              className="w-20"
            >
              {COMPARISON_OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Değer</p>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-24 font-mono"
              inputMode="decimal"
            />
          </div>
          <Button type="button" size="sm" onClick={addCondition} disabled={!nextAllowed || disabled}>
            <Plus className="h-4 w-4" />
            Ekle
          </Button>
          </div>
        </div>

        {!nextAllowed ? (
          <p className="text-xs text-warning">
            Free plan filtre sınırına ulaştınız. Sınırsız filtre için Basic veya Premium gerekir.
          </p>
        ) : null}

        <div className="flex min-h-10 flex-wrap gap-2 rounded-xl border border-dashed border-border bg-terminal/50 p-3">
          {dsl.conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz filtre eklenmedi.</p>
          ) : (
            <FilterTree group={dsl} onRemove={removeAt} />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Sonuçları bulmaya hazırsınız</p>
            <p className="text-xs text-muted-foreground">
              {conditionCount} koşul {dsl.operator === "AND" ? "birlikte" : "alternatif olarak"} uygulanacak.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => onRun?.(dsl)}
            disabled={conditionCount === 0 || disabled}
          >
            <Play className="h-4 w-4" />
            Taramayı çalıştır
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

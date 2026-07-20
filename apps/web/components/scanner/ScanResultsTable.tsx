"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  createColumnHelper,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingBlock } from "@/components/shared/states";
import { SymbolWithLogo } from "@/components/shared/StockLogo";
import { AnimatedList } from "@/components/reactbits/AnimatedList";
import type { ScanRow } from "@/lib/types";
import { formatNumber, formatPercent, cn } from "@/lib/utils";

const columnHelper = createColumnHelper<ScanRow>();

export function ScanResultsTable({
  rows,
  loading,
  onSelect,
  selectedSymbol,
  hasRun = false,
}: {
  rows: ScanRow[];
  loading?: boolean;
  onSelect?: (row: ScanRow) => void;
  selectedSymbol?: string | null;
  hasRun?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "volumeRatio", desc: true },
  ]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("symbol", {
        header: "Symbol",
        cell: (info) => <SymbolWithLogo symbol={info.getValue()} size="sm" />,
      }),
      columnHelper.accessor("price", {
        header: "Price",
        cell: (info) => <span className="font-mono">{formatNumber(info.getValue())}</span>,
      }),
      columnHelper.accessor("changePercent", {
        header: "Chg %",
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className={cn("font-mono", v >= 0 ? "text-success" : "text-destructive")}>
              {formatPercent(v)}
            </span>
          );
        },
      }),
      columnHelper.accessor("volume", {
        header: "Volume",
        cell: (info) => (
          <span className="font-mono">
            {new Intl.NumberFormat("en-US", { notation: "compact" }).format(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor("volumeRatio", {
        header: "Vol ×",
        cell: (info) => <span className="font-mono">{formatNumber(info.getValue(), 1)}</span>,
      }),
      columnHelper.accessor("rsi14", {
        header: "RSI",
        cell: (info) => <span className="font-mono">{formatNumber(info.getValue(), 1)}</span>,
      }),
      columnHelper.accessor("gapPercent", {
        header: "Gap %",
        cell: (info) => <span className="font-mono">{formatPercent(info.getValue())}</span>,
      }),
      columnHelper.display({
        id: "freshness",
        header: "Data",
        cell: ({ row }) =>
          row.original.stale ? (
            <Badge variant="warning">Stale</Badge>
          ) : (
            <Badge variant="outline">OK</Badge>
          ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (loading) return <LoadingBlock rows={6} />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={hasRun ? "No matches" : "No scan run yet"}
        description={
          hasRun
            ? "The scan completed successfully, but no symbols matched every filter."
            : "Choose or build a scan, then run it to load current market results."
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur">
      <AnimatedList maxVisible={12} itemHeight={52}>
        <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(header.column.getCanSort() && "cursor-pointer select-none")}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{
                    asc: " ↑",
                    desc: " ↓",
                  }[header.column.getIsSorted() as string] ?? null}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={selectedSymbol === row.original.symbol ? "selected" : undefined}
              className="cursor-pointer"
              onClick={() => onSelect?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </AnimatedList>
    </div>
  );
}

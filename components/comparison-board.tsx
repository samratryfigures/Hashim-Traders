"use client";

import { Plus, Scale, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { comparisonTotals, whereToBuy } from "@/lib/compare";
import { formatPkr, usdToPkr } from "@/lib/money";
import {
  emptyComparison,
  type ComparisonItem,
} from "@/lib/types";

export function ComparisonBoard({
  items,
  rate,
  onChange,
  onDelete,
}: {
  items: ComparisonItem[];
  rate: number;
  onChange: (items: ComparisonItem[]) => void;
  onDelete: (item: ComparisonItem) => void;
}) {
  function update(id: string, patch: Partial<ComparisonItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-2xl text-rose-950">
            <Scale className="size-5 text-rose-700" />
            Price comparison
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Put the US quote in dollars and the Pakistan quote in rupees. Totals
            use quantity and the US buy rate so you can see where to purchase.
          </p>
        </div>
        <Button
          onClick={() => onChange([...items, emptyComparison()])}
        >
          <Plus />
          Add item
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-rose-200 bg-white/80 px-4 py-10 text-center text-sm text-muted-foreground">
          No comparison items yet. Add something you might buy from the US or
          Pakistan to see which is cheaper.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-rose-100 bg-white/90 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>US price</TableHead>
                  <TableHead>PAK price</TableHead>
                  <TableHead>Where to buy</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <ComparisonRow
                    key={item.id}
                    item={item}
                    rate={rate}
                    onChange={(patch) => update(item.id, patch)}
                    onDelete={() => onDelete(item)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {items.map((item) => {
              const verdict = whereToBuy(item, rate);
              const totals = comparisonTotals(item, rate);
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-rose-100 bg-white/90 p-3"
                >
                  <Input
                    value={item.name}
                    placeholder="Item name"
                    onChange={(event) =>
                      update(item.id, { name: event.target.value })
                    }
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Quantity</p>
                      <Input
                        inputMode="numeric"
                        value={String(item.quantity)}
                        onChange={(event) =>
                          update(item.id, {
                            quantity: parseQuantity(event.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <BuyBadge label={verdict.label} source={verdict.source} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">US price</p>
                      <MoneyInput
                        prefix="$"
                        value={item.usUsd}
                        onValueChange={(usUsd) => update(item.id, { usUsd })}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {formatPkr(totals.usTotal)} for {totals.quantity}
                      </p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">PAK price</p>
                      <MoneyInput
                        prefix="₨"
                        value={item.pakPkr}
                        onValueChange={(pakPkr) => update(item.id, { pakPkr })}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {formatPkr(totals.pakTotal)} for {totals.quantity}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ComparisonRow({
  item,
  rate,
  onChange,
  onDelete,
}: {
  item: ComparisonItem;
  rate: number;
  onChange: (patch: Partial<ComparisonItem>) => void;
  onDelete: () => void;
}) {
  const totals = comparisonTotals(item, rate);
  const verdict = whereToBuy(item, rate);
  return (
    <TableRow>
      <TableCell className="min-w-44">
        <Input
          value={item.name}
          placeholder="e.g. Makeup kit"
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </TableCell>
      <TableCell className="w-24">
        <Input
          inputMode="numeric"
          value={String(item.quantity)}
          onChange={(event) =>
            onChange({ quantity: parseQuantity(event.target.value) })
          }
        />
      </TableCell>
      <TableCell className="min-w-36">
        <MoneyInput
          prefix="$"
          value={item.usUsd}
          onValueChange={(usUsd) => onChange({ usUsd })}
        />
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {item.usUsd === null
            ? "Enter USD"
            : `${formatPkr(usdToPkr(item.usUsd, rate))} each · ${formatPkr(totals.usTotal)} total`}
        </p>
      </TableCell>
      <TableCell className="min-w-36">
        <MoneyInput
          prefix="₨"
          value={item.pakPkr}
          onValueChange={(pakPkr) => onChange({ pakPkr })}
        />
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {item.pakPkr === null
            ? "Enter PKR"
            : `${formatPkr(item.pakPkr)} each · ${formatPkr(totals.pakTotal)} total`}
        </p>
      </TableCell>
      <TableCell>
        <BuyBadge label={verdict.label} source={verdict.source} />
        {verdict.savings ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Saves {formatPkr(verdict.savings)}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="icon-sm" onClick={onDelete}>
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function BuyBadge({
  label,
  source,
}: {
  label: string;
  source: ReturnType<typeof whereToBuy>["source"];
}) {
  const className =
    source === "US"
      ? "bg-sky-100 text-sky-800"
      : source === "PAK"
        ? "bg-emerald-100 text-emerald-800"
        : source === "same"
          ? "bg-amber-100 text-amber-900"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function parseQuantity(value: string) {
  const parsed = Number(value.replace(/[^\d]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(9999, Math.round(parsed));
}

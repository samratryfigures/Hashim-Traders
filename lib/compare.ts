import { usdToPkr } from "@/lib/money";
import type { ComparisonItem } from "@/lib/types";

export type BuySource = "US" | "PAK" | "same" | "need-prices";

export function comparisonTotals(
  item: ComparisonItem,
  rate: number
) {
  const quantity = Math.max(1, Math.round(item.quantity || 1));
  const usEach = usdToPkr(item.usUsd, rate);
  const pakEach = item.pakPkr;
  return {
    quantity,
    usEach,
    pakEach,
    usTotal: usEach === null ? null : usEach * quantity,
    pakTotal: pakEach === null ? null : pakEach * quantity,
  };
}

export function whereToBuy(
  item: ComparisonItem,
  rate: number
): { source: BuySource; label: string; savings: number | null } {
  const { usTotal, pakTotal } = comparisonTotals(item, rate);
  if (usTotal === null && pakTotal === null) {
    return { source: "need-prices", label: "Add both prices", savings: null };
  }
  if (usTotal === null) {
    return { source: "PAK", label: "Buy from Pakistan", savings: null };
  }
  if (pakTotal === null) {
    return { source: "US", label: "Buy from US", savings: null };
  }
  const gap = Math.round(Math.abs(usTotal - pakTotal));
  if (gap < 1) {
    return { source: "same", label: "Same in PKR", savings: 0 };
  }
  if (usTotal < pakTotal) {
    return { source: "US", label: "Buy from US", savings: gap };
  }
  return { source: "PAK", label: "Buy from Pakistan", savings: gap };
}

"use client";

import { MoneyInput } from "@/components/money-input";
import { isUsLocation } from "@/lib/pricing";
import { formatPkr, usdToPkr } from "@/lib/money";

export function PriceBlank({
  location,
  usd,
  pkr,
  rate,
  onUsdChange,
  onPkrChange,
}: {
  location: string;
  usd: number | null;
  pkr: number | null;
  rate: number;
  onUsdChange: (usd: number | null) => void;
  onPkrChange: (pkr: number | null) => void;
}) {
  if (isUsLocation(location)) {
    return (
      <div className="min-w-36 space-y-1">
        <MoneyInput prefix="$" value={usd} onValueChange={onUsdChange} />
        <p className="text-[11px] leading-tight text-muted-foreground tabular-nums">
          {formatPkr(usdToPkr(usd, rate))} in PKR
        </p>
      </div>
    );
  }

  return (
    <MoneyInput prefix="₨" value={pkr} onValueChange={onPkrChange} />
  );
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function parseMoney(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(parsed);
}

export function formatPkr(value: number | null | undefined) {
  if (value === null || value === undefined) return "₨ 0";
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function usdToPkr(usd: number | null, rate: number) {
  if (usd === null) return null;
  return roundMoney(usd * rate);
}

export function pkrToUsd(pkr: number | null, rate: number) {
  if (pkr === null || !rate) return null;
  return roundMoney(pkr / rate);
}

export function moneyInputValue(value: number | null) {
  return value === null ? "" : String(value);
}

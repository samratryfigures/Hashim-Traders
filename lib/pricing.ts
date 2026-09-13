import { pkrToUsd, usdToPkr } from "@/lib/money";
import type { PrepItem } from "@/lib/types";

export function isUsLocation(location: string) {
  const key = location.trim().toLowerCase().replace(/\./g, "");
  return (
    key === "us" ||
    key === "usa" ||
    key === "united states" ||
    key === "united states of america" ||
    key === "america"
  );
}

export function withLocationPrices(
  item: PrepItem,
  location: string,
  rate: number
): Partial<PrepItem> {
  if (isUsLocation(location)) {
    const expectedUsd = item.expectedUsd ?? pkrToUsd(item.expectedPkr, rate);
    const actualUsd = item.actualUsd ?? pkrToUsd(item.actualPkr, rate);
    return {
      location,
      expectedUsd,
      expectedPkr: usdToPkr(expectedUsd, rate),
      actualUsd,
      actualPkr:
        actualUsd === null ? item.actualPkr : usdToPkr(actualUsd, rate),
    };
  }

  return {
    location,
    expectedUsd: null,
    actualUsd: null,
    expectedPkr: item.expectedPkr ?? usdToPkr(item.expectedUsd, rate),
    actualPkr: item.actualPkr ?? usdToPkr(item.actualUsd, rate),
  };
}

export function convertUsPrices(item: PrepItem, rate: number): PrepItem {
  if (!isUsLocation(item.location)) return item;
  return {
    ...item,
    expectedPkr: usdToPkr(item.expectedUsd, rate),
    actualPkr:
      item.actualUsd === null ? item.actualPkr : usdToPkr(item.actualUsd, rate),
  };
}

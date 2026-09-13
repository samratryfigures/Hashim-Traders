export const ITEM_STATUSES = ["Pending", "In-Process", "Complete"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const DEFAULT_CATEGORIES = [
  "Furniture",
  "Dresses",
  "Accessories",
  "Makeup",
  "Shoes",
  "General Preps",
  "Personal Things",
  "Siblings Preps",
  "Parents Preps",
] as const;

export const DEFAULT_LOCATIONS = [
  "US",
  "PAK",
  "Khushab",
  "Naushera",
  "Lahore",
  "Faisalabad",
] as const;

export const DEFAULT_EXCHANGE_RATE = 278;

export type PrepItem = {
  id: string;
  name: string;
  status: ItemStatus;
  assignedTo: string;
  expectedUsd: number | null;
  expectedPkr: number | null;
  location: string;
  actualUsd: number | null;
  actualPkr: number | null;
  picture: string | null;
};

export type Category = {
  id: string;
  name: string;
  items: PrepItem[];
};

export type AppState = {
  exchangeRate: number;
  locations: string[];
  categories: Category[];
};

export type PersistenceBackend = "kv" | "neon" | "file" | "memory";

export type StateResponse = {
  state: AppState;
  backend: PersistenceBackend;
};

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function emptyItem(): PrepItem {
  return {
    id: createId(),
    name: "",
    status: "Pending",
    assignedTo: "",
    expectedUsd: null,
    expectedPkr: null,
    location: "PAK",
    actualUsd: null,
    actualPkr: null,
    picture: null,
  };
}

export function defaultState(): AppState {
  return {
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    locations: [...DEFAULT_LOCATIONS],
    categories: DEFAULT_CATEGORIES.map((name) => ({
      id: createId(),
      name,
      items: [],
    })),
  };
}

export function isItemStatus(value: string): value is ItemStatus {
  return ITEM_STATUSES.includes(value as ItemStatus);
}

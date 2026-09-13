import { NextResponse } from "next/server";
import { saveState, getState } from "@/lib/store";
import {
  DEFAULT_EXCHANGE_RATE,
  isItemStatus,
  type AppState,
  type Category,
  type PrepItem,
} from "@/lib/types";

export const runtime = "nodejs";

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeItem(raw: unknown): PrepItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : null;
  const name = typeof item.name === "string" ? item.name : "";
  const status =
    typeof item.status === "string" && isItemStatus(item.status)
      ? item.status
      : "Pending";
  if (!id) return null;
  return {
    id,
    name: name.slice(0, 200),
    status,
    assignedTo:
      typeof item.assignedTo === "string" ? item.assignedTo.slice(0, 80) : "",
    expectedUsd: asNumber(item.expectedUsd),
    expectedPkr: asNumber(item.expectedPkr),
    location: typeof item.location === "string" ? item.location.slice(0, 80) : "",
    actualUsd: asNumber(item.actualUsd),
    actualPkr: asNumber(item.actualPkr),
    picture:
      typeof item.picture === "string" && item.picture.startsWith("data:image/")
        ? item.picture
        : null,
  };
}

function sanitizeCategory(raw: unknown): Category | null {
  if (!raw || typeof raw !== "object") return null;
  const category = raw as Record<string, unknown>;
  const id = typeof category.id === "string" ? category.id : null;
  const name = typeof category.name === "string" ? category.name.trim() : "";
  if (!id || !name) return null;
  const items = Array.isArray(category.items)
    ? category.items.map(sanitizeItem).filter((item): item is PrepItem => !!item)
    : [];
  return { id, name: name.slice(0, 80), items };
}

function sanitizeState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== "object") return null;
  const state = raw as Record<string, unknown>;
  const exchangeRate = asNumber(state.exchangeRate) ?? DEFAULT_EXCHANGE_RATE;
  const locations = Array.isArray(state.locations)
    ? state.locations
        .filter((loc): loc is string => typeof loc === "string" && loc.trim().length > 0)
        .map((loc) => loc.trim().slice(0, 80))
    : [];
  const categories = Array.isArray(state.categories)
    ? state.categories
        .map(sanitizeCategory)
        .filter((category): category is Category => !!category)
    : [];
  if (categories.length === 0) return null;
  return {
    exchangeRate: Math.max(1, exchangeRate),
    locations: locations.length ? Array.from(new Set(locations)) : ["PAK"],
    categories,
  };
}

export async function GET() {
  const payload = await getState();
  return NextResponse.json(payload);
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming =
    body && typeof body === "object" && "state" in body
      ? (body as { state: unknown }).state
      : body;
  const state = sanitizeState(incoming);
  if (!state) {
    return NextResponse.json({ error: "Invalid planner data" }, { status: 400 });
  }

  const backend = await saveState(state);
  return NextResponse.json({ state, backend });
}

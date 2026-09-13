import type { AppState } from "@/lib/types";

const KEY = "wed-preps-state-v1";

export function itemCount(state: AppState) {
  return state.categories.reduce(
    (sum, category) => sum + category.items.length,
    0
  );
}

export function readLocalState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.categories?.length) return null;
    return {
      ...parsed,
      comparisons: Array.isArray(parsed.comparisons) ? parsed.comparisons : [],
    };
  } catch {
    return null;
  }
}

export function writeLocalState(state: AppState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or quota — server save can still succeed.
  }
}

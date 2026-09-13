import type { AppState, PrepItem } from "@/lib/types";

export const PERSON_ALL = "all";
export const PERSON_UNASSIGNED = "unassigned";

export function assigneeKey(name: string) {
  return name.trim().toLowerCase();
}

export function itemMatchesPerson(item: PrepItem, filter: string) {
  const assigned = item.assignedTo.trim();
  if (filter === PERSON_ALL) return true;
  if (filter === PERSON_UNASSIGNED) return assigned.length === 0;
  return assigneeKey(assigned) === filter;
}

export function uniqueAssignees(state: AppState) {
  const map = new Map<string, { name: string; count: number }>();
  for (const category of state.categories) {
    for (const item of category.items) {
      const name = item.assignedTo.trim();
      if (!name) continue;
      const key = assigneeKey(name);
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { name, count: 1 });
    }
  }
  return [...map.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function unassignedCount(state: AppState) {
  return state.categories.reduce(
    (sum, category) =>
      sum + category.items.filter((item) => !item.assignedTo.trim()).length,
    0
  );
}

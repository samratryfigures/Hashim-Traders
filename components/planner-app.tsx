"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Heart,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  ImagePlus,
  CloudOff,
  Cloud,
  HardDrive,
  Users,
} from "lucide-react";
import {
  PERSON_ALL,
  PERSON_UNASSIGNED,
  itemMatchesPerson,
  uniqueAssignees,
  unassignedCount,
} from "@/lib/assignees";
import { itemCount, readLocalState, writeLocalState } from "@/lib/local-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ItemFormDialog } from "@/components/item-form-dialog";
import { MoneyInput } from "@/components/money-input";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fileToCompressedDataUrl } from "@/lib/image";
import { formatPkr, usdToPkr } from "@/lib/money";
import {
  createId,
  emptyItem,
  ITEM_STATUSES,
  type AppState,
  type ItemStatus,
  type PersistenceBackend,
  type PrepItem,
  type StateResponse,
} from "@/lib/types";

type PendingDelete =
  | { type: "category"; id: string; name: string }
  | { type: "item"; categoryId: string; itemId: string; name: string };

export function PlannerApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [backend, setBackend] = useState<PersistenceBackend>("file");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [rename, setRename] = useState<{ id: string; name: string } | null>(
    null
  );
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [itemDialog, setItemDialog] = useState<{
    categoryId: string;
    item: PrepItem;
    title: string;
  } | null>(null);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(
    null
  );
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [personFilter, setPersonFilter] = useState(PERSON_ALL);
  const skipSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async (next: AppState) => {
    writeLocalState(next);
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      const payload = (await response.json()) as StateResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not save.");
      }
      setBackend(payload.backend);
      setSavedAt(new Date());
    } catch (error) {
      setSavedAt(new Date());
      setSaveError(
        error instanceof Error
          ? error.message
          : "Saved on this device, but could not sync."
      );
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok) throw new Error("Could not load planner data.");
        const payload = (await response.json()) as StateResponse;
        if (cancelled) return;
        const local = readLocalState();
        const serverEmpty = itemCount(payload.state) === 0;
        const useLocal =
          !!local &&
          itemCount(local) > 0 &&
          (payload.backend === "memory" || serverEmpty);
        const chosen = useLocal && local ? local : payload.state;
        skipSave.current = !useLocal;
        setState(chosen);
        setBackend(payload.backend);
        setOpenCategories(chosen.categories.map((category) => category.id));
        writeLocalState(chosen);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load planner data."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(state);
    }, 450);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, persist]);

  const people = useMemo(
    () => (state ? uniqueAssignees(state) : []),
    [state]
  );
  const noneAssigned = state ? unassignedCount(state) : 0;
  const selectedPerson =
    personFilter === PERSON_ALL
      ? "Everyone"
      : personFilter === PERSON_UNASSIGNED
        ? "Unassigned"
        : (people.find((person) => person.key === personFilter)?.name ??
          "Everyone");

  const visibleCategories = useMemo(() => {
    if (!state) return [];
    return state.categories.map((category) => ({
      ...category,
      items: category.items.filter((item) =>
        itemMatchesPerson(item, personFilter)
      ),
    }));
  }, [state, personFilter]);

  const totals = useMemo(() => {
    let expected = 0;
    let actual = 0;
    let complete = 0;
    let pending = 0;
    let totalItems = 0;
    for (const category of visibleCategories) {
      for (const item of category.items) {
        totalItems += 1;
        expected += item.expectedPkr ?? 0;
        actual += item.actualPkr ?? 0;
        if (item.status === "Complete") complete += 1;
        else pending += 1;
      }
    }
    return {
      expected,
      actual,
      remaining: expected - actual,
      complete,
      pending,
      totalItems,
    };
  }, [visibleCategories]);

  function updateItem(
    categoryId: string,
    itemId: string,
    patch: Partial<PrepItem>
  ) {
    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        categories: current.categories.map((category) =>
          category.id === categoryId
            ? {
                ...category,
                items: category.items.map((item) =>
                  item.id === itemId ? { ...item, ...patch } : item
                ),
              }
            : category
        ),
      };
    });
  }

  function addLocation(location: string) {
    setState((current) => {
      if (!current) return current;
      if (current.locations.includes(location)) return current;
      return { ...current, locations: [...current.locations, location] };
    });
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Wed Preps could not load</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          Loading your wedding preps…
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-rose-100/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-1 flex items-center gap-2 text-xs font-medium tracking-[0.2em] text-rose-700 uppercase">
              <Heart className="size-3.5 fill-rose-400 text-rose-400" />
              Family planning board
            </p>
            <h1 className="font-serif text-4xl tracking-tight text-rose-950 sm:text-5xl">
              Wed Preps
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Shared shopping, outfits, and family preps — one link, no logins.
              Everyone sees the same list.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="fx-rate">Static exchange rate (1 USD = PKR)</Label>
              <Input
                id="fx-rate"
                className="w-40 bg-white"
                inputMode="decimal"
                value={String(state.exchangeRate)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setState({
                    ...state,
                    exchangeRate: Number.isFinite(next) && next > 0 ? next : state.exchangeRate,
                  });
                }}
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-white px-3 py-2 text-xs text-muted-foreground">
              {backend === "kv" || backend === "neon" ? (
                <Cloud className="size-4 text-emerald-600" />
              ) : backend === "file" ? (
                <HardDrive className="size-4 text-rose-700" />
              ) : (
                <CloudOff className="size-4 text-amber-600" />
              )}
              <span>
                {saving
                  ? "Saving…"
                  : saveError
                    ? saveError
                    : savedAt
                      ? `Saved ${savedAt.toLocaleTimeString()}`
                      : backend === "kv" || backend === "neon"
                        ? "Saved for everyone on this link"
                        : "Saved on this device"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-rose-100 bg-white/80 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-rose-950">
            <Users className="size-4 text-rose-700" />
            Filter by who is doing
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <PersonTab
              active={personFilter === PERSON_ALL}
              onClick={() => setPersonFilter(PERSON_ALL)}
              label="Everyone"
              count={itemCount(state)}
            />
            <PersonTab
              active={personFilter === PERSON_UNASSIGNED}
              onClick={() => setPersonFilter(PERSON_UNASSIGNED)}
              label="Unassigned"
              count={noneAssigned}
            />
            {people.map((person) => (
              <PersonTab
                key={person.key}
                active={personFilter === person.key}
                onClick={() => setPersonFilter(person.key)}
                label={person.name}
                count={person.count}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Total expected cost"
            value={formatPkr(totals.expected)}
            hint={
              personFilter === PERSON_ALL
                ? "Sum of expected PKR across all items"
                : `Expected PKR for ${selectedPerson}`
            }
          />
          <SummaryCard
            label="Total actual spent"
            value={formatPkr(totals.actual)}
            hint={
              personFilter === PERSON_ALL
                ? "Sum of actual bought prices"
                : `Actual spend for ${selectedPerson}`
            }
          />
          <SummaryCard
            label={totals.remaining >= 0 ? "Remaining budget" : "Over budget"}
            value={formatPkr(Math.abs(totals.remaining))}
            hint={
              totals.remaining >= 0
                ? "Expected minus actual"
                : "Actual is higher than expected"
            }
            tone={totals.remaining >= 0 ? "ok" : "over"}
          />
          <Card className="bg-white/90">
            <CardHeader>
              <CardDescription>Category progress</CardDescription>
              <CardTitle className="text-lg">
                {totals.complete} complete · {totals.pending} pending
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress
                value={
                  totals.totalItems
                    ? Math.round((totals.complete / totals.totalItems) * 100)
                    : 0
                }
              />
              {visibleCategories.map((category) => {
                const total = category.items.length;
                const done = category.items.filter(
                  (item) => item.status === "Complete"
                ).length;
                return (
                  <div key={category.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{category.name}</span>
                      <span className="text-muted-foreground">
                        {done}/{total || 0}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-rose-100">
                      <div
                        className="h-full rounded-full bg-rose-400"
                        style={{
                          width: `${total ? (done / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={newCategory}
            placeholder="New category name"
            className="bg-white sm:max-w-xs"
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const name = newCategory.trim();
                if (!name) return;
                const id = createId();
                setState({
                  ...state,
                  categories: [...state.categories, { id, name, items: [] }],
                });
                setOpenCategories((open) => [...open, id]);
                setNewCategory("");
              }
            }}
          />
          <Button
            onClick={() => {
              const name = newCategory.trim();
              if (!name) return;
              const id = createId();
              setState({
                ...state,
                categories: [...state.categories, { id, name, items: [] }],
              });
              setOpenCategories((open) => [...open, id]);
              setNewCategory("");
            }}
          >
            <Plus />
            Add category
          </Button>
        </section>

        <div className="space-y-4">
          {visibleCategories.map((category) => {
            const done = category.items.filter(
              (item) => item.status === "Complete"
            ).length;
            const expected = category.items.reduce(
              (sum, item) => sum + (item.expectedPkr ?? 0),
              0
            );
            const isOpen = openCategories.includes(category.id);
            return (
              <Card key={category.id} className="overflow-hidden bg-white/90">
                <div className="flex w-full items-start justify-between gap-3 px-4 py-4">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left md:pointer-events-none"
                    aria-expanded={isOpen}
                    onClick={() => {
                      if (window.matchMedia("(min-width: 768px)").matches) return;
                      setOpenCategories((open) =>
                        open.includes(category.id)
                          ? open.filter((id) => id !== category.id)
                          : [...open, category.id]
                      );
                    }}
                  >
                    <h2 className="font-serif text-2xl text-rose-950">
                      {category.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {done}/{category.items.length} complete · expected{" "}
                      {formatPkr(expected)}
                      {personFilter !== PERSON_ALL ? ` · ${selectedPerson}` : ""}
                    </p>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        const item = emptyItem();
                        if (
                          personFilter !== PERSON_ALL &&
                          personFilter !== PERSON_UNASSIGNED
                        ) {
                          item.assignedTo = selectedPerson;
                        }
                        setItemDialog({
                          categoryId: category.id,
                          item,
                          title: `Add item to ${category.name}`,
                        });
                      }}
                    >
                      <Plus />
                      Add item
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" />}
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setRename({ id: category.id, name: category.name })
                          }
                        >
                          <Pencil />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setPendingDelete({
                              type: "category",
                              id: category.id,
                              name: category.name,
                            })
                          }
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className={isOpen ? "block" : "hidden md:block"}>
                  {category.items.length === 0 ? (
                    <p className="px-4 pb-5 text-sm text-muted-foreground">
                      {personFilter === PERSON_ALL
                        ? `No items yet. Add the first ${category.name.toLowerCase()} prep for the family list.`
                        : `No ${category.name.toLowerCase()} items for ${selectedPerson}.`}
                    </p>
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Item name</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Assigned to</TableHead>
                              <TableHead>Expected USD</TableHead>
                              <TableHead>Expected PKR</TableHead>
                              <TableHead>Bought from</TableHead>
                              <TableHead>Actual USD</TableHead>
                              <TableHead>Actual PKR</TableHead>
                              <TableHead>Picture</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {category.items.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="min-w-40">
                                  <Input
                                    value={item.name}
                                    onChange={(event) =>
                                      updateItem(category.id, item.id, {
                                        name: event.target.value,
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={item.status}
                                    onValueChange={(value) => {
                                      if (value) {
                                        updateItem(category.id, item.id, {
                                          status: value as ItemStatus,
                                        });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="min-w-32">
                                      <SelectValue>
                                        <StatusBadge status={item.status} />
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ITEM_STATUSES.map((status) => (
                                        <SelectItem key={status} value={status}>
                                          {status}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="min-w-32">
                                  <Input
                                    value={item.assignedTo}
                                    placeholder="Ayesha"
                                    onChange={(event) =>
                                      updateItem(category.id, item.id, {
                                        assignedTo: event.target.value,
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="min-w-28">
                                  <MoneyInput
                                    prefix="$"
                                    value={item.expectedUsd}
                                    onValueChange={(expectedUsd) =>
                                      updateItem(category.id, item.id, {
                                        expectedUsd,
                                        expectedPkr: usdToPkr(
                                          expectedUsd,
                                          state.exchangeRate
                                        ),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="min-w-28">
                                  <MoneyInput
                                    prefix="₨"
                                    value={item.expectedPkr}
                                    onValueChange={(expectedPkr) =>
                                      updateItem(category.id, item.id, {
                                        expectedPkr,
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <LocationSelect
                                    value={item.location}
                                    locations={state.locations}
                                    onChange={(location) =>
                                      updateItem(category.id, item.id, {
                                        location,
                                      })
                                    }
                                    onAddLocation={addLocation}
                                  />
                                </TableCell>
                                <TableCell className="min-w-28">
                                  <MoneyInput
                                    prefix="$"
                                    value={item.actualUsd}
                                    onValueChange={(actualUsd) =>
                                      updateItem(category.id, item.id, {
                                        actualUsd,
                                        actualPkr:
                                          actualUsd === null
                                            ? item.actualPkr
                                            : usdToPkr(
                                                actualUsd,
                                                state.exchangeRate
                                              ),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="min-w-28">
                                  <MoneyInput
                                    prefix="₨"
                                    value={item.actualPkr}
                                    onValueChange={(actualPkr) =>
                                      updateItem(category.id, item.id, {
                                        actualPkr,
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <PictureCell
                                    item={item}
                                    onPicture={(picture) =>
                                      updateItem(category.id, item.id, {
                                        picture,
                                      })
                                    }
                                    onPreview={() =>
                                      item.picture &&
                                      setPreview({
                                        src: item.picture,
                                        name: item.name,
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() =>
                                        setItemDialog({
                                          categoryId: category.id,
                                          item,
                                          title: `Edit ${item.name || "item"}`,
                                        })
                                      }
                                    >
                                      <Pencil />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() =>
                                        setPendingDelete({
                                          type: "item",
                                          categoryId: category.id,
                                          itemId: item.id,
                                          name: item.name || "this item",
                                        })
                                      }
                                    >
                                      <Trash2 />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="space-y-3 px-4 pb-4 md:hidden">
                        {category.items.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-xl border border-rose-100 bg-rose-50/40 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-medium">{item.name || "Untitled item"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.assignedTo || "Unassigned"} · {item.location || "No location"}
                                </p>
                              </div>
                              <StatusBadge status={item.status} />
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <dt className="text-muted-foreground">Expected</dt>
                                <dd>{formatPkr(item.expectedPkr)}</dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">Actual</dt>
                                <dd>{formatPkr(item.actualPkr)}</dd>
                              </div>
                            </dl>
                            <div className="mt-3 flex items-center justify-between">
                              {item.picture ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreview({
                                      src: item.picture as string,
                                      name: item.name,
                                    })
                                  }
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.picture}
                                    alt=""
                                    className="size-12 rounded-lg object-cover"
                                  />
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No photo
                                </span>
                              )}
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setItemDialog({
                                      categoryId: category.id,
                                      item,
                                      title: `Edit ${item.name || "item"}`,
                                    })
                                  }
                                >
                                  <Pencil />
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() =>
                                    setPendingDelete({
                                      type: "item",
                                      categoryId: category.id,
                                      itemId: item.id,
                                      name: item.name || "this item",
                                    })
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </main>

      <ItemFormDialog
        open={!!itemDialog}
        item={itemDialog?.item ?? null}
        locations={state.locations}
        exchangeRate={state.exchangeRate}
        title={itemDialog?.title ?? "Item"}
        onOpenChange={(open) => {
          if (!open) setItemDialog(null);
        }}
        onAddLocation={addLocation}
        onSave={(item) => {
          if (!itemDialog) return;
          setState((current) => {
            if (!current) return current;
            return {
              ...current,
              categories: current.categories.map((category) => {
                if (category.id !== itemDialog.categoryId) return category;
                const exists = category.items.some((entry) => entry.id === item.id);
                return {
                  ...category,
                  items: exists
                    ? category.items.map((entry) =>
                        entry.id === item.id ? item : entry
                      )
                    : [...category.items, item],
                };
              }),
            };
          });
        }}
      />

      <Dialog open={!!rename} onOpenChange={(open) => !open && setRename(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename category</DialogTitle>
          </DialogHeader>
          <Input
            value={rename?.name ?? ""}
            onChange={(event) =>
              setRename((current) =>
                current ? { ...current, name: event.target.value } : current
              )
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rename?.name.trim()) return;
                setState({
                  ...state,
                  categories: state.categories.map((category) =>
                    category.id === rename.id
                      ? { ...category, name: rename.name.trim() }
                      : category
                  ),
                });
                setRename(null);
              }}
            >
              Save name
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.name || "Photo"}</DialogTitle>
          </DialogHeader>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.src}
              alt={preview.name}
              className="max-h-[70vh] w-full rounded-xl object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        title={
          pendingDelete?.type === "category"
            ? `Delete ${pendingDelete.name}?`
            : `Delete ${pendingDelete?.name ?? "item"}?`
        }
        description={
          pendingDelete?.type === "category"
            ? "This removes the category and every item inside it for everyone sharing this link."
            : "This removes the item from the shared wedding list."
        }
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          setState((current) => {
            if (!current) return current;
            if (pendingDelete.type === "category") {
              return {
                ...current,
                categories: current.categories.filter(
                  (category) => category.id !== pendingDelete.id
                ),
              };
            }
            return {
              ...current,
              categories: current.categories.map((category) =>
                category.id === pendingDelete.categoryId
                  ? {
                      ...category,
                      items: category.items.filter(
                        (item) => item.id !== pendingDelete.itemId
                      ),
                    }
                  : category
              ),
            };
          });
        }}
      />
    </div>
  );
}

function PersonTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "shrink-0 rounded-full bg-rose-700 px-3 py-1.5 text-sm text-white"
          : "shrink-0 rounded-full border border-rose-100 bg-white px-3 py-1.5 text-sm text-rose-950 hover:bg-rose-50"
      }
    >
      {label}
      <span className={active ? "ml-1.5 text-white/80" : "ml-1.5 text-muted-foreground"}>
        {count}
      </span>
    </button>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ok" | "over";
}) {
  return (
    <Card className={tone === "over" ? "bg-rose-50/90" : "bg-white/90"}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-sans text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

function LocationSelect({
  value,
  locations,
  onChange,
  onAddLocation,
}: {
  value: string;
  locations: string[];
  onChange: (value: string) => void;
  onAddLocation: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const options = locations.includes(value) || !value ? locations : [...locations, value];

  if (adding) {
    return (
      <div className="flex min-w-40 gap-1">
        <Input
          autoFocus
          value={draft}
          placeholder="Location"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          size="sm"
          onClick={() => {
            const name = draft.trim();
            if (!name) return;
            onAddLocation(name);
            onChange(name);
            setDraft("");
            setAdding(false);
          }}
        >
          Save
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "__add__") {
          setAdding(true);
          return;
        }
        if (next) onChange(next);
      }}
    >
      <SelectTrigger className="min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((location) => (
          <SelectItem key={location} value={location}>
            {location}
          </SelectItem>
        ))}
        <SelectItem value="__add__">+ Add location</SelectItem>
      </SelectContent>
    </Select>
  );
}

function PictureCell({
  item,
  onPicture,
  onPreview,
}: {
  item: PrepItem;
  onPicture: (picture: string | null) => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {item.picture ? (
        <button type="button" onClick={onPreview} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.picture}
            alt=""
            className="size-10 rounded-md object-cover ring-1 ring-border"
          />
        </button>
      ) : null}
      <Button size="icon-sm" variant="outline" render={<label />}>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            onPicture(await fileToCompressedDataUrl(file));
          }}
        />
        <ImagePlus />
      </Button>
    </div>
  );
}

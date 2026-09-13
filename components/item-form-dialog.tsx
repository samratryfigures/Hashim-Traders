"use client";

import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PriceBlank } from "@/components/price-blank";
import { fileToCompressedDataUrl } from "@/lib/image";
import { usdToPkr } from "@/lib/money";
import { isUsLocation, withLocationPrices } from "@/lib/pricing";
import {
  ITEM_STATUSES,
  type ItemStatus,
  type PrepItem,
} from "@/lib/types";

export function ItemFormDialog({
  open,
  item,
  locations,
  exchangeRate,
  title,
  onOpenChange,
  onSave,
  onAddLocation,
}: {
  open: boolean;
  item: PrepItem | null;
  locations: string[];
  exchangeRate: number;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: (item: PrepItem) => void;
  onAddLocation: (location: string) => void;
}) {
  if (!open || !item) return null;

  return (
    <ItemFormFields
      key={`${item.id}-${title}`}
      item={item}
      locations={locations}
      exchangeRate={exchangeRate}
      title={title}
      onOpenChange={onOpenChange}
      onSave={onSave}
      onAddLocation={onAddLocation}
    />
  );
}

function ItemFormFields({
  item,
  locations,
  exchangeRate,
  title,
  onOpenChange,
  onSave,
  onAddLocation,
}: {
  item: PrepItem;
  locations: string[];
  exchangeRate: number;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: (item: PrepItem) => void;
  onAddLocation: (location: string) => void;
}) {
  const [draft, setDraft] = useState<PrepItem>(item);
  const [locationPrompt, setLocationPrompt] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [imageError, setImageError] = useState("");

  const locationOptions = locations.includes(draft.location)
    ? locations
    : draft.location
      ? [...locations, draft.location]
      : locations;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isUsLocation(draft.location)
              ? `US buy: enter USD. Shown in PKR at 1 USD = ${exchangeRate} PKR.`
              : "Pakistan buy: enter PKR only. US conversion is not applied."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="item-name">Item name</Label>
            <Input
              id="item-name"
              value={draft.name}
              placeholder="e.g. Reception sofa set"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) => {
                  if (value) setDraft({ ...draft, status: value as ItemStatus });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="assigned-to">Assigned to / who is doing</Label>
              <Input
                id="assigned-to"
                value={draft.assignedTo}
                placeholder="e.g. Ayesha, Ali"
                onChange={(event) =>
                  setDraft({ ...draft, assignedTo: event.target.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Bought from</Label>
            {locationPrompt ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newLocation}
                  placeholder="New shopping location"
                  onChange={(event) => setNewLocation(event.target.value)}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const name = newLocation.trim();
                    if (!name) return;
                    onAddLocation(name);
                    setDraft({
                      ...draft,
                      ...withLocationPrices(draft, name, exchangeRate),
                    });
                    setNewLocation("");
                    setLocationPrompt(false);
                  }}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocationPrompt(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Select
                value={draft.location}
                onValueChange={(value) => {
                  if (value === "__add__") {
                    setLocationPrompt(true);
                    return;
                  }
                  if (value) {
                    setDraft({
                      ...draft,
                      ...withLocationPrices(draft, value, exchangeRate),
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                  <SelectItem value="__add__">+ Add location</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>
                {isUsLocation(draft.location)
                  ? "Expected price (USD → PKR)"
                  : "Expected price (PKR)"}
              </Label>
              <PriceBlank
                location={draft.location}
                usd={draft.expectedUsd}
                pkr={draft.expectedPkr}
                rate={exchangeRate}
                onUsdChange={(expectedUsd) =>
                  setDraft({
                    ...draft,
                    expectedUsd,
                    expectedPkr: usdToPkr(expectedUsd, exchangeRate),
                  })
                }
                onPkrChange={(expectedPkr) =>
                  setDraft({
                    ...draft,
                    expectedUsd: null,
                    expectedPkr,
                  })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>
                {isUsLocation(draft.location)
                  ? "Actual bought price (USD → PKR)"
                  : "Actual bought price (PKR)"}
              </Label>
              <PriceBlank
                location={draft.location}
                usd={draft.actualUsd}
                pkr={draft.actualPkr}
                rate={exchangeRate}
                onUsdChange={(actualUsd) =>
                  setDraft({
                    ...draft,
                    actualUsd,
                    actualPkr: usdToPkr(actualUsd, exchangeRate),
                  })
                }
                onPkrChange={(actualPkr) =>
                  setDraft({
                    ...draft,
                    actualUsd: null,
                    actualPkr,
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Picture</Label>
            <div className="flex items-center gap-3">
              {draft.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.picture}
                  alt={draft.name || "Item photo"}
                  className="size-16 rounded-lg object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ImagePlus className="size-5" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" render={<label />}>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      try {
                        const picture = await fileToCompressedDataUrl(file);
                        setDraft((current) =>
                          current ? { ...current, picture } : current
                        );
                        setImageError("");
                      } catch {
                        setImageError("Could not read that photo. Try another image.");
                      }
                    }}
                  />
                  Upload photo
                </Button>
                {draft.picture ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft({ ...draft, picture: null })}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
            {imageError ? (
              <p className="text-xs text-destructive">{imageError}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave({ ...draft, name: draft.name.trim() || "Untitled item" });
              onOpenChange(false);
            }}
          >
            Save item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

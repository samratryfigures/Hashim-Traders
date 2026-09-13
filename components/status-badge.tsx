"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ItemStatus } from "@/lib/types";

const STATUS_STYLES: Record<ItemStatus, string> = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  "In-Process": "bg-sky-100 text-sky-800 border-sky-200",
  Complete: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ItemStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("border font-medium", STATUS_STYLES[status], className)}
    >
      {status}
    </Badge>
  );
}

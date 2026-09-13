"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { moneyInputValue, parseMoney } from "@/lib/money";

export function MoneyInput({
  value,
  onValueChange,
  prefix,
  className,
  placeholder = "0",
}: {
  value: number | null;
  onValueChange: (value: number | null) => void;
  prefix?: string;
  className?: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(moneyInputValue(value));
  const display = focused ? text : moneyInputValue(value);

  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <Input
        inputMode="decimal"
        placeholder={placeholder}
        className={prefix ? `pl-8 ${className ?? ""}` : className}
        value={display}
        onFocus={() => {
          setText(moneyInputValue(value));
          setFocused(true);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          onValueChange(parseMoney(next));
        }}
        onBlur={() => {
          setFocused(false);
          setText(moneyInputValue(value));
        }}
      />
    </div>
  );
}

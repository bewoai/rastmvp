"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

export type PeriodMode = "month" | "all";

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return "Ay seçin";
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export default function MonthFilter({
  mode,
  month,
  onModeChange,
  onMonthChange,
}: {
  mode: PeriodMode;
  month: string;
  onModeChange: (mode: PeriodMode) => void;
  onMonthChange: (month: string) => void;
}) {
  return (
    <div role="group" aria-label="Dönem" className="flex flex-wrap items-center gap-1.5">
      <button type="button" aria-pressed={mode === "month"} onClick={() => onModeChange("month")} className={`h-9 rounded-lg px-3 text-xs font-medium transition-colors md:h-8 ${mode === "month" ? "bg-amber/20 text-amber" : "bg-surface-2/70 text-muted hover:text-foreground"}`}>Seçili Ay</button>
      <button type="button" aria-pressed={mode === "all"} onClick={() => onModeChange("all")} className={`h-9 rounded-lg px-3 text-xs font-medium transition-colors md:h-8 ${mode === "all" ? "bg-amber/20 text-amber" : "bg-surface-2/70 text-muted hover:text-foreground"}`}>Tüm Dönem</button>
      {mode === "month" && <div className="flex h-9 items-center overflow-hidden rounded-lg border border-border bg-background md:h-8">
        <button type="button" aria-label="Önceki ay" onClick={() => onMonthChange(shiftMonth(month, -1))} className="flex h-full w-9 items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground md:w-8"><ChevronLeft className="h-4 w-4" /></button>
        <label className="relative flex min-w-[150px] cursor-pointer items-center justify-center gap-2 px-2 text-xs font-medium capitalize text-foreground focus-within:ring-2 focus-within:ring-amber/60">
          <CalendarDays className="h-3.5 w-3.5 text-amber" aria-hidden />
          {monthLabel(month)}
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Görüntülenecek ay"
          />
        </label>
        <button type="button" aria-label="Sonraki ay" onClick={() => onMonthChange(shiftMonth(month, 1))} className="flex h-full w-9 items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground md:w-8"><ChevronRight className="h-4 w-4" /></button>
      </div>}
    </div>
  );
}

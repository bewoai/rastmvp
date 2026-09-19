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
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => onModeChange("month")} className={`rounded-lg px-3 py-2 text-sm ${mode === "month" ? "bg-amber/20 text-amber" : "text-muted hover:text-foreground"}`}>Seçili Ay</button>
      <button onClick={() => onModeChange("all")} className={`rounded-lg px-3 py-2 text-sm ${mode === "all" ? "bg-amber/20 text-amber" : "text-muted hover:text-foreground"}`}>Tüm Dönem</button>
      {mode === "month" && <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background">
        <button aria-label="Önceki ay" onClick={() => onMonthChange(shiftMonth(month, -1))} className="p-2 text-muted hover:bg-surface-2 hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <label className="relative flex min-w-[175px] cursor-pointer items-center justify-center gap-2 px-3 py-2 text-sm font-medium capitalize text-foreground">
          <CalendarDays className="h-4 w-4 text-amber" />
          {monthLabel(month)}
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Görüntülenecek ay"
          />
        </label>
        <button aria-label="Sonraki ay" onClick={() => onMonthChange(shiftMonth(month, 1))} className="p-2 text-muted hover:bg-surface-2 hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>}
    </div>
  );
}

"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Calendar, Check, Flag, X } from "lucide-react";
import { patchTask } from "@/lib/taskActions";
import { formatDue } from "@/lib/taskLogic";
import { priority as prioMap, taskStatus, taskBoard } from "@/lib/labels";
import type { Priority, Task, TaskStatus } from "@/lib/types";

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];

type Tone = "default" | "amber" | "success" | "warning" | "danger" | "muted";
const toneText: Record<Tone, string> = {
  default: "text-foreground",
  amber: "text-amber",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted",
};

// Öncelik halkası (tamamlama dairesi) — Todoist tarzı
const prioRing: Record<Priority, string> = {
  urgent: "border-danger",
  high: "border-warning",
  medium: "border-amber/70",
  low: "border-muted",
};

const chipCls =
  "relative inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-surface-2 focus-within:ring-2 focus-within:ring-amber/60";

// Masaüstünde ikincil chip'ler hover/focus'ta belirir; dokunmatikte (mobil) hep görünür.
const revealCls = "md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100";

/**
 * Kompakt görev satırı. Düzenleme durumu (başlık düzenleme) satırın kendisinde tutulur;
 * `task` referansı değişmedikçe memo sayesinde başka görevlerin değişikliği bu satırı render etmez.
 */
const TaskRow = memo(function TaskRow({
  task,
  projectName,
  today,
}: {
  task: Task;
  projectName?: string;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  const dateRef = useRef<HTMLInputElement>(null);

  const done = task.status === "done";
  const due = task.due_date ? task.due_date.slice(0, 10) : "";
  const overdue = !done && !!due && due < today;
  const prio = prioMap[task.priority] ?? prioMap.medium;
  const status = taskStatus[task.status];

  useEffect(() => {
    if (!editing) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [editing]);

  function startEdit() {
    settledRef.current = false;
    setEditing(true);
  }

  // Enter/blur kaydeder, Escape vazgeçer. settledRef: Enter + ardından gelen blur çift kayıt yapmasın.
  function finishEdit(save: boolean) {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = titleRef.current?.value.trim() ?? "";
    setEditing(false);
    if (save && next && next !== task.title) patchTask(task.id, { title: next });
  }

  function openPicker() {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  }

  return (
    <li className="group flex min-h-10 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 transition-colors focus-within:bg-surface-2/50 hover:bg-surface-2/50">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Görevi yeniden aç" : "Görevi tamamla"}
        onClick={() => patchTask(task.id, { status: done ? "todo" : "done" })}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          done
            ? "border-success bg-success text-background"
            : `${prioRing[task.priority] ?? prioRing.medium} text-transparent hover:bg-white/10 hover:text-muted`
        }`}
      >
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      </button>

      <div className="min-w-0 flex-1 basis-40">
        {editing ? (
          <input
            ref={titleRef}
            type="text"
            defaultValue={task.title}
            aria-label="Görev başlığı"
            maxLength={300}
            onBlur={() => finishEdit(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                finishEdit(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finishEdit(false);
              }
            }}
            className="w-full rounded-md border border-amber/60 bg-background/70 px-2 py-0.5 text-sm text-foreground outline-none ring-4 ring-amber/10"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            title="Düzenlemek için tıkla"
            className={`block w-full truncate rounded-md px-0.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-amber/60 ${
              done ? "text-muted line-through" : "text-foreground"
            }`}
          >
            {task.title}
          </button>
        )}
      </div>

      <div className="ml-7 flex flex-wrap items-center gap-x-1 gap-y-0.5 sm:ml-0">
        {projectName && <span className="max-w-[9rem] truncate px-1 text-xs text-muted">{projectName}</span>}

        {!done && (
          <label
            className={`${chipCls} ${toneText[status.tone]} ${task.status === "todo" ? revealCls : ""}`}
          >
            <span>{status.label}</span>
            <select
              aria-label="Durum"
              value={task.status}
              onChange={(e) => patchTask(task.id, { status: e.target.value as TaskStatus })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {taskBoard.map((st) => (
                <option key={st} value={st}>{taskStatus[st].label}</option>
              ))}
            </select>
          </label>
        )}

        <span
          className={`${chipCls} ${
            overdue ? "text-danger" : due === today ? "text-success" : "text-muted"
          } ${due ? "" : revealCls}`}
        >
          <button
            type="button"
            onClick={openPicker}
            aria-label={due ? `Son tarih: ${formatDue(due, today)}. Değiştir` : "Son tarih ekle"}
            className="inline-flex items-center gap-1 outline-none"
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            {due && <span>{formatDue(due, today)}</span>}
          </button>
          <input
            ref={dateRef}
            type="date"
            tabIndex={-1}
            aria-hidden
            value={due}
            onChange={(e) => patchTask(task.id, { due_date: e.target.value })}
            // Yalnızca showPicker() için bağlantı noktası: hiçbir kontrolün üstüne binmez
            className="pointer-events-none absolute left-0 top-full h-px w-px opacity-0"
          />
          {due && (
            <button
              type="button"
              onClick={() => patchTask(task.id, { due_date: "" })}
              aria-label="Son tarihi kaldır"
              className="rounded text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-amber/60"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </span>

        <label className={`${chipCls} ${toneText[prio.tone]}`}>
          <Flag className="h-3.5 w-3.5" aria-hidden />
          <span>{prio.label}</span>
          <select
            aria-label="Öncelik"
            value={task.priority}
            onChange={(e) => patchTask(task.id, { priority: e.target.value as Priority })}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{prioMap[p].label}</option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
});

export default TaskRow;

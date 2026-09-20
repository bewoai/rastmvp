"use client";

import { useEffect, useState } from "react";
import { todayKey } from "./taskLogic";

/** Bugünün yerel YYYY-MM-DD'si; sekme geri odaklanınca gün değiştiyse yenilenir. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayKey());

  useEffect(() => {
    const refresh = () => setToday((prev) => {
      const now = todayKey();
      return now === prev ? prev : now;
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return today;
}

"use client";

import { useEffect, useState } from "react";

/** Şimdiki zaman (ms); `intervalMs`'de bir ve sekme geri odaklanınca yenilenir (render sırasında Date.now() çağrılmaz). */
export function useNowMs(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);

  return now;
}

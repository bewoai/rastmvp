import { useEffect, useState } from "react";
import { useStore, COLLECTIONS } from "./store";
import type { RastData } from "./types";

export function useCollections(collections: (keyof RastData)[]) {
  const loaded = useStore((s) => s.loaded);
  const load = useStore((s) => s.load);
  const loadedCollections = useStore((s) => s.loadedCollections);
  const isSupabase = useStore((s) => s.supabase);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    if (!isSupabase) {
      setReady(true);
      return;
    }
    const missing = collections.filter(c => !loadedCollections[c]);
    if (missing.length > 0) {
      load(missing).then(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [loaded, isSupabase, loadedCollections, collections, load]);

  return loaded && ready;
}

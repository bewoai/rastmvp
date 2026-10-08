import { useEffect } from "react";
import { useStore } from "./store";
import type { RastData } from "./types";

/**
 * İstenen koleksiyonları (eksikse) yükler ve hepsi hazır olduğunda true döner.
 * "Hazır" durumu effect içinde setState ile değil, store'dan render sırasında türetilir.
 */
export function useCollections(collections: (keyof RastData)[]) {
  const loaded = useStore((s) => s.loaded);
  const load = useStore((s) => s.load);
  const loadedCollections = useStore((s) => s.loadedCollections);
  const isSupabase = useStore((s) => s.supabase);
  const orgId = useStore((s) => s.orgId);

  useEffect(() => {
    if (!loaded || !isSupabase) return;
    const missing = collections.filter((c) => !loadedCollections[c]);
    if (missing.length > 0) void load(missing);
  }, [loaded, isSupabase, loadedCollections, collections, load]);

  if (!loaded) return false;
  // Demo modu veya org'suz oturum: store.load hiçbir şey yüklemez — eskisi gibi hazır say.
  if (!isSupabase || !orgId) return true;
  return collections.every((c) => loadedCollections[c]);
}

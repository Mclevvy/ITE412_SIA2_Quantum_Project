import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import type { Database } from "firebase/database";
import { db as primaryDb } from "../lib/firebase";

interface HistoryListOptions {
  /** Exact ordering; each screen passes its current comparator unchanged. */
  sort?: (a: any, b: any) => number;
  /** Applied after sort (same order as the inline code it replaces). */
  filter?: (item: any) => boolean;
  /** Reverse key order (bottling reports show newest keys first). */
  reverse?: boolean;
  /** Take only the first N entries after sort/filter. */
  limit?: number;
  /**
   * Clear the list when the node is deleted. Defaults to false to preserve
   * the Tracker/Insights/Bottling behavior (no else branch — stale list
   * stays until the next snapshot with data). ReportsAnalytics passes true.
   */
  clearOnEmpty?: boolean;
}

/**
 * Subscribes to a push-keyed history node (`Object.keys(data).map(key =>
 * ({ id: key, ...data[key] }))`) — the fetch duplicated across
 * FermentationTracker, PredictiveInsights, ReportsAnalytics (all on
 * `fermentation/history`) and BottleFillingPage (on `filling/history`).
 *
 * Returns the mapped list plus `isLoading` (false after the first snapshot,
 * or immediately when Firebase is unavailable) and `hiddenInvalidCount`
 * (entries dropped by `filter`; 0 when no filter is given).
 *
 * `db` defaults to the primary app's database; pass another `Database` (e.g.
 * the read-only filler project) to list a history node from that project.
 */
export function useHistoryList(
  path: string,
  options?: HistoryListOptions,
  db: Database | null = primaryDb
) {
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hiddenInvalidCount, setHiddenInvalidCount] = useState(0);

  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }
    const sort = options?.sort;
    const filter = options?.filter;
    const reverse = options?.reverse;
    const limit = options?.limit;
    const clearOnEmpty = options?.clearOnEmpty ?? false;

    const unsubscribe = onValue(ref(db, path), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        let list = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
        if (sort) list = [...list].sort(sort);
        if (reverse) list = [...list].reverse();
        const rawLength = list.length;
        if (filter) list = list.filter(filter);
        setHiddenInvalidCount(rawLength - list.length);
        if (typeof limit === "number") list = list.slice(0, limit);
        setItems(list);
      } else if (clearOnEmpty) {
        setItems([]);
        setHiddenInvalidCount(0);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
    // Options are static literals per call site; resubscribe on path/db only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, db]);

  return { items, isLoading, hiddenInvalidCount };
}

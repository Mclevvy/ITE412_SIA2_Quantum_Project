import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import {
  Database,
  off,
  onValue,
  query,
  ref,
  limitToLast,
} from "firebase/database";

type Point = { time: number; value: number };

function toPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.value) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

export function useSensors() {
  const [current, setCurrent] = useState<{
    temperature: number | null;
    sugarBrix: number | null;
    ph: number | null;
    updatedAt: number | null;
  }>({ temperature: null, sugarBrix: null, ph: null, updatedAt: null });

  const [history, setHistory] = useState<{
    temperature: Point[];
    sugarBrix: Point[];
    ph: Point[];
  }>({ temperature: [], sugarBrix: [], ph: [] });

  const [isLive, setIsLive] = useState(false);
  const [dbReady, setDbReady] = useState<boolean>(!!db);

  useEffect(() => {
    // ✅ If db is null, don't call ref() at all
    if (!db) {
      setDbReady(false);
      setIsLive(false);
      setCurrent({ temperature: null, sugarBrix: null, ph: null, updatedAt: null });
      setHistory({ temperature: [], sugarBrix: [], ph: [] });
      return;
    }

    setDbReady(true);

    const database: Database = db;

    // CURRENT
    const currentRef = ref(database, "sensors/current");

    onValue(
      currentRef,
      (snap) => {
        const v = snap.val();
        if (!v) {
          setIsLive(false);
          setCurrent({ temperature: null, sugarBrix: null, ph: null, updatedAt: null });
          return;
        }

        setIsLive(true);
        setCurrent({
          temperature: typeof v.temperature === "number" ? v.temperature : null,
          sugarBrix: typeof v.sugarBrix === "number" ? v.sugarBrix : null,
          ph: typeof v.ph === "number" ? v.ph : null,
          updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : Date.now(),
        });
      },
      () => setIsLive(false)
    );

    // HISTORY (last 30)
    const tempQ = query(ref(database, "sensors/history/temperature"), limitToLast(30));
    const brixQ = query(ref(database, "sensors/history/sugarBrix"), limitToLast(30));
    const phQ = query(ref(database, "sensors/history/ph"), limitToLast(30));

    onValue(tempQ, (snap) =>
      setHistory((h) => ({ ...h, temperature: toPoints(snap.val()) }))
    );
    onValue(brixQ, (snap) =>
      setHistory((h) => ({ ...h, sugarBrix: toPoints(snap.val()) }))
    );
    onValue(phQ, (snap) =>
      setHistory((h) => ({ ...h, ph: toPoints(snap.val()) }))
    );

    // CLEANUP
    return () => {
      off(currentRef);
      off(ref(database, "sensors/history/temperature"));
      off(ref(database, "sensors/history/sugarBrix"));
      off(ref(database, "sensors/history/ph"));
    };
  }, []);

  const formatted = useMemo(() => {
    const formatTime = (ts: number) =>
      new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return {
      tempData: history.temperature.map((p) => ({ time: formatTime(p.time), value: p.value })),
      sugarData: history.sugarBrix.map((p) => ({ time: formatTime(p.time), value: p.value })),
      phData: history.ph.map((p) => ({ time: formatTime(p.time), value: p.value })),
    };
  }, [history]);

  return { current, history, formatted, isLive, dbReady };
}

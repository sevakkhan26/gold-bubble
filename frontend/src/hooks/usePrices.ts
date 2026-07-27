import { useCallback, useEffect, useState } from "react";
import {
  fetchDebug,
  fetchHealth,
  fetchPrices,
  type DebugPayload,
  type Health,
  type PriceModel,
  type SourceReport,
} from "@/lib/api";

const REFRESH_MS = 15_000;

export function usePrices() {
  const [prices, setPrices] = useState<PriceModel | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [report, setReport] = useState<SourceReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [p, h, d] = await Promise.all([
        fetchPrices(),
        fetchHealth().catch(() => null),
        fetchDebug().catch(() => null as DebugPayload | null),
      ]);
      setPrices(p);
      if (h) setHealth(h);
      if (d?.report) setReport(d.report);
      else if (p.report) setReport(p.report);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت قیمت");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { prices, health, report, error, loading, updatedAt, refresh };
}

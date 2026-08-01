import { useCallback, useEffect, useState } from "react";
import { fetchWalletBalances, type WalletBalances } from "@/lib/api";

const REFRESH_MS = 60_000;

/** Live balances pulled from the user's configured exchange endpoints. */
export function useWalletBalances() {
  const [data, setData] = useState<WalletBalances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const d = await fetchWalletBalances();
      setData(d);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت موجودی");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, error, loading, updatedAt, refresh };
}

/** Types + fetch helpers for the FastAPI backend. */

export type Pair = { buy?: number | null; sell?: number | null; latest?: number | null };

export type ExchangeRow = {
  usdt?: Pair | null;
  usd?: Pair | null;
  aed?: Pair | null;
  gold18PerKg?: Pair | null;
  shemsh24PerKg?: Pair | null;
};

export type PriceModel = {
  updatedAt?: string;
  ounceUsd?: number | null;
  exchanges?: Record<string, ExchangeRow>;
  market?: {
    usd?: Pair | null;
    aed?: Pair | null;
    gold18PerKg?: Pair | null;
    shemsh24PerKg?: Pair | null;
  };
  usdtByExchange?: Record<string, Pair | null>;
  foreignGold?: { "pax-gold"?: number | null; "tether-gold"?: number | null };
  sources?: Record<string, { source?: string; live?: boolean; estimated?: boolean }>;
  estimated?: { usd?: boolean; gold?: boolean };
  anyLive?: boolean;
  stale?: boolean;
  ageMs?: number | null;
  version?: string;
  gitSha?: string;
  buildTime?: string;
  error?: string;
  message?: string;
  report?: SourceReport[];
};

export type SourceReport = {
  source: string;
  label: string;
  ok: boolean;
  ms?: number | null;
  error?: string | null;
};

export type Health = {
  ok: boolean;
  version?: string;
  gitSha?: string;
  buildTime?: string;
  refreshSec?: number;
  navasanKey?: string;
  brsApiKey?: string;
  lastRefreshAt?: number;
  proxy?: boolean;
};

export type DebugPayload = {
  lastRefreshAt?: number;
  report?: SourceReport[];
  version?: string;
  gitSha?: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "/api";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchPrices() {
  return getJson<PriceModel>("/prices");
}

export function fetchHealth() {
  return getJson<Health>("/health");
}

export function fetchDebug() {
  return getJson<DebugPayload>("/debug");
}

export const EXCHANGE_META: { id: string; fa: string }[] = [
  { id: "navasan", fa: "نوسان" },
  { id: "bonbast", fa: "بن‌بست" },
  { id: "nobitex", fa: "نوبیتکس" },
  { id: "wallex", fa: "والکس" },
  { id: "bitpin", fa: "بیت‌پین" },
  { id: "tabdeal", fa: "تبدیل" },
  { id: "abantether", fa: "آبان تتر" },
  { id: "ramzinex", fa: "رمزینکس" },
  { id: "exir", fa: "اکسیر" },
  { id: "tetherland", fa: "تتر لند" },
];

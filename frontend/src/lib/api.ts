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

/** One user-configured exchange endpoint that reports a wallet balance. */
export type WalletConnection = {
  id: number;
  label: string;
  asset: string;
  enabled: boolean;
  method: string;
  url: string;
  /** Values come back masked (••••••); send the mask back to keep the stored secret. */
  headers: Record<string, string>;
  body?: string | null;
  jsonPath: string;
  multiplier: number;
  lastValue?: number | null;
  lastOk?: boolean | null;
  lastError?: string | null;
  lastCheckedAt?: string | null;
};

export type WalletConnectionInput = {
  label: string;
  asset: string;
  url: string;
  jsonPath: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  multiplier?: number;
  enabled?: boolean;
};

export type WalletBalances = {
  balances: Record<string, number>;
  connections: {
    id: number;
    label: string;
    asset: string;
    ok: boolean;
    value: number | null;
    ms?: number | null;
    error?: string | null;
  }[];
  fetchedAt?: number;
};

export const SECRET_MASK = "••••••";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new Error(detail || body?.message || body?.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string): Promise<T> {
  return request<T>(path);
}

function sendJson<T>(path: string, method: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
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

export function fetchWalletConnections() {
  return getJson<{ assets: string[]; connections: WalletConnection[] }>("/wallet/connections");
}

export function createWalletConnection(payload: WalletConnectionInput) {
  return sendJson<WalletConnection>("/wallet/connections", "POST", payload);
}

export function updateWalletConnection(id: number, payload: Partial<WalletConnectionInput>) {
  return sendJson<WalletConnection>(`/wallet/connections/${id}`, "PATCH", payload);
}

export function deleteWalletConnection(id: number) {
  return sendJson<{ ok: boolean }>(`/wallet/connections/${id}`, "DELETE");
}

export function testWalletConnection(id: number) {
  return sendJson<{ ok: boolean; value: number | null; ms?: number; error?: string | null }>(
    `/wallet/connections/${id}/test`,
    "POST"
  );
}

export function fetchWalletBalances() {
  return getJson<WalletBalances>("/wallet/balances");
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

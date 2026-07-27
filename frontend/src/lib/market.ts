import type { ExchangeRow, Pair, PriceModel } from "@/lib/api";

export const EXCHANGES = [
  { id: "bonbast", fa: "بن‌بست" },
  { id: "navasan", fa: "نوسان" },
  { id: "nobitex", fa: "نوبیتکس" },
  { id: "wallex", fa: "والکس" },
  { id: "bitpin", fa: "بیت‌پین" },
  { id: "tabdeal", fa: "تبدیل" },
  { id: "abantether", fa: "آبان تتر" },
  { id: "ramzinex", fa: "رمزینکس" },
  { id: "exir", fa: "اکسیر" },
  { id: "tetherland", fa: "تتر لند" },
] as const;

/** Foreign gold rows — all live from backend */
export const FOREIGN_GOLD = [
  { name: "پکس گلد (PAXG)", coinId: "pax-gold" as const },
  { name: "تتر گلد (XAUT)", coinId: "tether-gold" as const },
  { name: "اسپات جهانی (gold-api)", useSpot: true as const },
];

export type ExId = (typeof EXCHANGES)[number]["id"];

export type RateEntry = {
  usd?: Pair | null;
  usdt?: Pair | null;
  aed?: Pair | null;
  gold18?: Pair | null;
  shemsh24?: Pair | null;
};

export type RateTag = {
  state: "live" | "empty" | "mock";
  liveKeys: string[];
  estimated?: boolean;
};

export type Settings = {
  aedPeg: number;
  purity: number;
  troyOunce: number;
  refreshSec: number;
};

export const DEFAULT_SETTINGS: Settings = {
  aedPeg: 3.6725,
  purity: 0.75,
  troyOunce: 31.103,
  refreshSec: 15,
};

export function mapLiveModelToRates(model: PriceModel): {
  rates: Record<string, RateEntry>;
  tags: Record<string, RateTag>;
} {
  const rates: Record<string, RateEntry> = {};
  const tags: Record<string, RateTag> = {};
  const byEx = model.exchanges || {};
  const market = model.market || {};
  const estimated = model.estimated || {};

  const mktAed = market.aed || null;
  const mktG18 = market.gold18PerKg || null;
  const mktG24 = market.shemsh24PerKg || null;
  const mktUsd = market.usd || null;

  for (const ex of EXCHANGES) {
    const e: ExchangeRow = byEx[ex.id] || {};
    const usdt = e.usdt || null;
    const usd = e.usd || usdt || mktUsd;
    const entry: RateEntry = {
      usd: usd || null,
      usdt,
      aed: e.aed || mktAed || null,
      gold18: e.gold18PerKg || mktG18 || null,
      shemsh24: e.shemsh24PerKg || mktG24 || null,
    };
    const liveKeys = (["usdt", "usd", "aed", "gold18", "shemsh24"] as const).filter(
      (k) => entry[k]
    );
    rates[ex.id] = entry;
    tags[ex.id] = {
      state: liveKeys.length ? "live" : "empty",
      liveKeys: [...liveKeys],
      estimated: !e.usd && !!usdt,
    };
  }

  const homeId = byEx.navasan ? "navasan" : byEx.bonbast ? "bonbast" : "navasan";
  const home = { ...(rates[homeId] || {}) };
  let touched = false;
  if (!home.usd && market.usd) {
    home.usd = market.usd;
    touched = true;
  }
  if (!home.aed && market.aed) {
    home.aed = market.aed;
    touched = true;
  }
  if (!home.gold18 && market.gold18PerKg) {
    home.gold18 = market.gold18PerKg;
    touched = true;
  }
  if (!home.shemsh24 && market.shemsh24PerKg) {
    home.shemsh24 = market.shemsh24PerKg;
    touched = true;
  }
  if (touched) {
    rates[homeId] = home;
    const liveKeys = Object.keys(home).filter((k) => (home as Record<string, unknown>)[k]);
    tags[homeId] = {
      state: "live",
      liveKeys,
      estimated: !!(estimated.usd || estimated.gold),
    };
  }

  return { rates, tags };
}

export function gold24FromKg(
  dollarToman: number | null | undefined,
  ounceUsd: number | null | undefined,
  troy: number
): number | null {
  if (!ounceUsd || !dollarToman || !troy) return null;
  return (ounceUsd * dollarToman) / troy * 1000;
}

export function gold18FromKg(
  dollarToman: number | null | undefined,
  ounceUsd: number | null | undefined,
  troy: number,
  purity: number
): number | null {
  const g = gold24FromKg(dollarToman, ounceUsd, troy);
  return g == null ? null : g * purity;
}

export function bubble(quoted: number | null | undefined, fair: number | null | undefined) {
  if (quoted == null || fair == null || !fair) return { amount: null as number | null, pct: null as number | null };
  const amount = quoted - fair;
  return { amount, pct: (amount / fair) * 100 };
}

export function avgOf(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function pickSell(p?: Pair | null): number | null {
  if (!p) return null;
  return p.sell ?? p.buy ?? p.latest ?? null;
}

export function pickBuy(p?: Pair | null): number | null {
  if (!p) return null;
  return p.buy ?? p.sell ?? p.latest ?? null;
}

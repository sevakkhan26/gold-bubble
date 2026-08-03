import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Coins,
  LayoutDashboard,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Radio,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ArbitrageSection, type ArbSide } from "@/components/ArbitrageSection";
import { TradeConnectors } from "@/components/TradeConnectors";
import { WalletConnections } from "@/components/WalletConnections";
import { usePrices } from "@/hooks/usePrices";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import {
  DEFAULT_SETTINGS,
  EXCHANGES,
  avgOf,
  gold18FromKg,
  gold24FromKg,
  mapLiveModelToRates,

  pickSell,
  type Settings,
} from "@/lib/market";
import { cn, formatToman, formatUsd, timeAgo } from "@/lib/utils";

type PageId =
  | "market"
  | "usdt"
  | "gold18"
  | "gold24"
  | "usd"
  | "aed"
  | "wallet"
  | "sources"
  | "settings";

const PAGE_ROUTES: Record<PageId, string> = {
  market: "/market",
  usdt: "/usdt",
  gold18: "/gold18",
  gold24: "/gold24",
  usd: "/usd",
  aed: "/aed",
  wallet: "/wallet",
  sources: "/sources",
  settings: "/settings",
};

/** Paths from the older, page-per-bubble layout. */
const LEGACY_ROUTES: Record<string, PageId> = {
  "/b18dom": "gold18",
  "/b18for": "gold18",
  "/b24dom": "gold24",
  "/b24for": "gold24",
  "/baed": "aed",
  "/busd": "usd",
  "/bubbles": "market",
  "/formulas": "market",
  "/alerts": "market",
};

function pageFromPath(pathname: string): PageId {
  const p = pathname.replace(/\/+$/, "") || "/";
  const hit = (Object.entries(PAGE_ROUTES) as [PageId, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? LEGACY_ROUTES[p] ?? "market";
}

const NAV: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "market", label: "تابلوی بازار", icon: LayoutDashboard },
  { id: "usdt", label: "آربیتراژ تتر", icon: Coins },
  { id: "gold18", label: "آربیتراژ طلای ۱۸", icon: Coins },
  { id: "gold24", label: "آربیتراژ طلای ۲۴", icon: Coins },
  { id: "usd", label: "آربیتراژ دلار", icon: Sparkles },
  { id: "aed", label: "آربیتراژ درهم", icon: Sparkles },
  { id: "wallet", label: "کیف پول", icon: Wallet },
  { id: "sources", label: "منابع API", icon: Radio },
  { id: "settings", label: "تنظیمات", icon: SettingsIcon },
];

const PAGE_META: Record<PageId, { title: string; subtitle: string }> = {
  market: { title: "تابلوی بازار", subtitle: "نرخ زنده هر منبع" },
  usdt: { title: "آربیتراژ تتر", subtitle: "اختلاف تتر بین صرافی‌ها" },
  gold18: { title: "آربیتراژ طلای ۱۸", subtitle: "بازار داخلی در برابر ارزش انس جهانی" },
  gold24: { title: "آربیتراژ طلای ۲۴", subtitle: "بازار داخلی در برابر ارزش انس جهانی" },
  usd: { title: "آربیتراژ دلار", subtitle: "بازار آزاد در برابر ارزش ضمنی درهم" },
  aed: { title: "آربیتراژ درهم", subtitle: "بازار آزاد در برابر ارزش منصفانه دلار" },
  wallet: { title: "کیف پول", subtitle: "موجودی دارایی‌ها و ارزش لحظه‌ای آن‌ها" },
  sources: { title: "منابع API", subtitle: "اتصال‌های موجودی و معامله + وضعیت provider‌ها" },
  settings: { title: "تنظیمات", subtitle: "پارامترهای محاسبه" },
};

type WalletAssetId =
  | "gold18dom"
  | "gold18for"
  | "gold24dom"
  | "gold24for"
  | "usd"
  | "aed"
  | "usdt"
  | "toman";

type WalletGroup = "gold18" | "gold24" | "cash";

const WALLET_GROUPS: { id: WalletGroup; fa: string; note: string }[] = [
  { id: "gold18", fa: "طلای ۱۸ عیار", note: "داخلی از بازار ایران · خارجی از انس جهانی" },
  { id: "gold24", fa: "طلای ۲۴ عیار", note: "داخلی از بازار ایران · خارجی از انس جهانی" },
  { id: "cash", fa: "ارز و نقد", note: "نرخ زنده صرافی‌ها" },
];

const WALLET_ASSETS: {
  id: WalletAssetId;
  group: WalletGroup;
  fa: string;
  unit: string;
}[] = [
  { id: "gold18dom", group: "gold18", fa: "۱۸ عیار داخلی", unit: "گرم" },
  { id: "gold18for", group: "gold18", fa: "۱۸ عیار خارجی", unit: "گرم" },
  { id: "gold24dom", group: "gold24", fa: "۲۴ عیار داخلی", unit: "گرم" },
  { id: "gold24for", group: "gold24", fa: "۲۴ عیار خارجی", unit: "گرم" },
  { id: "usd", group: "cash", fa: "دلار", unit: "دلار" },
  { id: "aed", group: "cash", fa: "درهم", unit: "درهم" },
  { id: "usdt", group: "cash", fa: "تتر", unit: "تتر" },
  { id: "toman", group: "cash", fa: "موجودی تومانی", unit: "تومان" },
];

/** طلاهای داخلی نرخ دستی می‌پذیرند (خالی = نرخ زنده بازار). */
const MANUAL_RATE_ASSETS: WalletAssetId[] = ["gold18dom", "gold24dom"];

/** کیف پول قدیمی یک ردیف طلا داشت — به نسخه داخلی منتقل می‌شود. */
function migrateWallet(raw: Record<string, number>): Record<string, number> {
  const w = { ...raw };
  if (w.gold18 != null && w.gold18dom == null) w.gold18dom = w.gold18;
  if (w.gold24 != null && w.gold24dom == null) w.gold24dom = w.gold24;
  delete w.gold18;
  delete w.gold24;
  return w;
}

export default function App() {
  const { prices, health, report, error, loading, updatedAt, refresh } = usePrices();
  const {
    data: walletLive,
    error: walletLiveError,
    refresh: refreshWalletLive,
  } = useWalletBalances();
  const [page, setPage] = useState<PageId>(() =>
    typeof window !== "undefined" ? pageFromPath(window.location.pathname) : "market"
  );
  const [busy, setBusy] = useState(false);

  const navigate = (id: PageId) => {
    setPage(id);
    const path = PAGE_ROUTES[id];
    if (window.location.pathname !== path) {
      window.history.pushState({ page: id }, "", path);
    }
  };

  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    if (window.location.pathname === "/" || window.location.pathname === "") {
      window.history.replaceState({ page: "market" }, "", "/market");
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem("gb-settings");
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [wallet, setWallet] = useState<Record<string, number>>(() => {
    try {
      return migrateWallet(JSON.parse(localStorage.getItem("gb-wallet") || "{}"));
    } catch {
      return {};
    }
  });
  const [walletRates, setWalletRates] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem("gb-wallet-rates") || "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem("gb-settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("gb-wallet", JSON.stringify(wallet));
  }, [wallet]);
  useEffect(() => {
    localStorage.setItem("gb-wallet-rates", JSON.stringify(walletRates));
  }, [walletRates]);

  const { rates } = useMemo(
    () => (prices ? mapLiveModelToRates(prices) : { rates: {}, tags: {} }),
    [prices]
  );

  const ounceUsd = prices?.ounceUsd ?? null;
  const usdSells = EXCHANGES.map((e) => pickSell(rates[e.id]?.usd)).filter((v): v is number => v != null);
  const avgUsdSell = avgOf(usdSells);
  const domAvg18 = avgOf(
    EXCHANGES.map((e) => pickSell(rates[e.id]?.gold18)).filter((v): v is number => v != null)
  );
  const domAvg24 = avgOf(
    EXCHANGES.map((e) => pickSell(rates[e.id]?.shemsh24)).filter((v): v is number => v != null)
  );

  const marketUsd = pickSell(prices?.market?.usd) ?? avgUsdSell;
  const marketAed = pickSell(prices?.market?.aed);
  const fairAed = marketUsd != null ? Math.round(marketUsd / settings.aedPeg) : null;

  const usdtSell =
    pickSell(prices?.usdtByExchange?.nobitex) ?? pickSell(prices?.usdtByExchange?.wallex);

  const exchangeNames = Object.fromEntries(EXCHANGES.map((ex) => [ex.id, ex.fa]));

  const perGram = (perKg: number | null | undefined) => (perKg == null ? null : perKg / 1000);

  /** Cheapest place to buy tether right now, across the venues that report a book. */
  const bestUsdtAsk = (() => {
    const asks = EXCHANGES.map((ex) => pickSell(prices?.usdtByExchange?.[ex.id])).filter(
      (v): v is number => v != null
    );
    return asks.length ? Math.min(...asks) : null;
  })();

  /** USDT is the one asset quoted per venue for real — every row is its own book. */
  const usdtSides = (): ArbSide[] =>
    EXCHANGES.map((ex) => {
      const pair = prices?.usdtByExchange?.[ex.id];
      return { key: ex.id, label: ex.fa, buy: pair?.buy ?? null, sell: pair?.sell ?? null };
    }).filter((s) => s.buy != null || s.sell != null);

  /**
   * Gold, dollar and dirham come from one market feed, not per venue — comparing
   * ten identical rows would be theatre. The real gap is market vs reference.
   */
  const goldSides = (carat: 18 | 24): ArbSide[] => {
    const pair =
      carat === 18 ? prices?.market?.gold18PerKg : prices?.market?.shemsh24PerKg;
    const globalPerKg =
      carat === 18
        ? gold18FromKg(marketUsd, ounceUsd, settings.troyOunce, settings.purity)
        : gold24FromKg(marketUsd, ounceUsd, settings.troyOunce);
    const globalGram = perGram(globalPerKg);
    return [
      {
        key: "domestic",
        label: "بازار داخلی",
        note: "TGJU — نرخ واحد بازار",
        buy: perGram(pair?.buy ?? null),
        sell: perGram(pair?.sell ?? null),
      },
      {
        key: "global",
        label: "ارزش جهانی",
        note: `انس ${formatUsd(ounceUsd)}$ × دلار ÷ ${settings.troyOunce}${carat === 18 ? ` × ${settings.purity}` : ""}`,
        buy: globalGram,
        sell: globalGram,
      },
    ];
  };

  const usdSides = (): ArbSide[] => {
    const implied = marketAed != null ? marketAed * settings.aedPeg : null;
    return [
      {
        key: "market",
        label: "بازار آزاد",
        note: "TGJU",
        buy: prices?.market?.usd?.buy ?? null,
        sell: prices?.market?.usd?.sell ?? null,
      },
      {
        key: "implied",
        label: "ضمنی از درهم",
        note: `درهم × ${settings.aedPeg}`,
        buy: implied,
        sell: implied,
      },
    ];
  };

  const aedSides = (): ArbSide[] => [
    {
      key: "market",
      label: "بازار آزاد",
      note: "TGJU",
      buy: prices?.market?.aed?.buy ?? null,
      sell: prices?.market?.aed?.sell ?? null,
    },
    {
      key: "fair",
      label: "منصفانه از دلار",
      note: `دلار ÷ ${settings.aedPeg}`,
      buy: fairAed,
      sell: fairAed,
    },
  ];

  /** قیمت هر واحد از دارایی کیف پول به تومان */
  const walletUnitPrice = (id: WalletAssetId): number | null => {
    if (id === "toman") return 1;
    if (id === "usd") return marketUsd;
    if (id === "aed") return marketAed ?? fairAed;
    if (id === "usdt") return usdtSell;
    if (id === "gold18dom") {
      const kg = pickSell(prices?.market?.gold18PerKg) ?? domAvg18;
      return kg != null ? kg / 1000 : null;
    }
    if (id === "gold24dom") {
      const kg = pickSell(prices?.market?.shemsh24PerKg) ?? domAvg24;
      return kg != null ? kg / 1000 : null;
    }
    if (id === "gold18for") {
      const kg = gold18FromKg(marketUsd, ounceUsd, settings.troyOunce, settings.purity);
      return kg != null ? kg / 1000 : null;
    }
    if (id === "gold24for") {
      const kg = gold24FromKg(marketUsd, ounceUsd, settings.troyOunce);
      return kg != null ? kg / 1000 : null;
    }
    return null;
  };

  const walletRows = WALLET_ASSETS.map((a) => {
    const autoQty = walletLive?.balances?.[a.id] ?? null;
    const manualQty = wallet[a.id] == null ? null : Number(wallet[a.id]) || 0;
    const qty = manualQty ?? autoQty ?? 0;
    const canSetRate = MANUAL_RATE_ASSETS.includes(a.id);
    const livePrice = walletUnitPrice(a.id);
    const manualPrice = canSetRate ? Number(walletRates[a.id]) || null : null;
    const unitPrice = manualPrice ?? livePrice;
    const value = unitPrice != null ? qty * unitPrice : null;
    return { ...a, qty, autoQty, manualQty, canSetRate, livePrice, manualPrice, unitPrice, value };
  });
  const walletTotal = walletRows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const walletTotalUsd = marketUsd ? walletTotal / marketUsd : null;
  const gold18Gram = walletRows.find((r) => r.id === "gold18dom")?.unitPrice ?? null;
  const walletTotalGold18 = gold18Gram ? walletTotal / gold18Gram : null;

  const onRefresh = async () => {
    setBusy(true);
    await refresh();
    setBusy(false);
  };

  const meta = PAGE_META[page];

  return (
    <div dir="rtl" lang="fa" className="app-shell">
      <aside className="app-sidebar">
        <div className="border-b border-border px-4 py-4">
          <div className="t-lg font-bold tracking-tight">تابلوی بازار</div>
          <div className="t-num t-sm text-muted-foreground">
            v{prices?.version || health?.version || "—"}
            {(prices?.gitSha || health?.gitSha) &&
              ` · ${String(prices?.gitSha || health?.gitSha).slice(0, 7)}`}
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={cn("nav-item", active ? "nav-item-active" : "nav-item-idle")}
              >
                <Icon className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
                <span className="flex-1">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-border p-3 t-sm leading-relaxed text-muted-foreground">
          shadcn/ui · داده زنده
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="min-w-0">
            <h1 className="t-xl font-bold text-foreground">{meta.title}</h1>
            <p className="mt-1 t-sm text-muted-foreground">{meta.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {prices && !prices.stale ? <Badge variant="live">زنده</Badge> : null}
            {prices?.stale ? <Badge variant="est">آخرین معتبر</Badge> : null}
            {error && !prices ? <Badge variant="danger">خطا</Badge> : null}
            {!prices && !error && loading ? <Badge variant="muted">بارگذاری</Badge> : null}
            <span className="t-sm text-muted-foreground">
              بروزرسانی: {timeAgo(updatedAt)}
            </span>
            <Button size="sm" onClick={() => void onRefresh()} disabled={busy}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              بروزرسانی
            </Button>
          </div>
        </header>

        <main className="app-content">
          {error && !prices ? (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-destructive">خطا در API</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {loading && !prices ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : null}

          {/* ---- MARKET: live rates only, one row per real source ---- */}
          {page === "market" && prices ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["انس جهانی", `${formatUsd(ounceUsd)} $`],
                    ["دلار بازار", formatToman(marketUsd)],
                    ["درهم بازار", formatToman(marketAed)],
                    ["تتر (ارزان‌ترین)", formatToman(bestUsdtAsk)],
                    ["طلای ۱۸ (گرم)", formatToman(perGram(pickSell(prices.market?.gold18PerKg)))],
                    ["طلای ۲۴ (گرم)", formatToman(perGram(pickSell(prices.market?.shemsh24PerKg)))],
                    ["PAXG", `${formatUsd(prices.foreignGold?.["pax-gold"])} $`],
                    ["XAUT", `${formatUsd(prices.foreignGold?.["tether-gold"])} $`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="stat-card">
                    <CardHeader className="pb-2">
                      <CardDescription>{label}</CardDescription>
                      <CardTitle className="t-num-lg font-bold tracking-tight">{value}</CardTitle>
                    </CardHeader>
                  </div>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>تتر — نرخ هر صرافی</CardTitle>
                  <CardDescription>
                    تنها دارایی که هر صرافی نرخ خودش را می‌دهد · برای معامله به صفحه «آربیتراژ تتر»
                    بروید
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-right">صرافی</th>
                        <th className="py-2 text-left text-buy">خرید</th>
                        <th className="py-2 text-left text-sell">فروش</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usdtSides().map((s) => (
                        <tr key={s.key} className="border-b border-border/50">
                          <td className="py-2 text-right font-semibold">{s.label}</td>
                          <td className="t-num py-2 text-left text-buy">{formatToman(s.buy)}</td>
                          <td className="t-num py-2 text-left text-sell">{formatToman(s.sell)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* ---- WALLET ---- */}
          {page === "wallet" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="stat-card">
                  <CardHeader className="pb-2">
                    <CardDescription>ارزش کل کیف پول</CardDescription>
                    <CardTitle className="t-num-lg font-bold tracking-tight text-primary">
                      {formatToman(walletTotal)} تومان
                    </CardTitle>
                  </CardHeader>
                </div>
                <div className="stat-card">
                  <CardHeader className="pb-2">
                    <CardDescription>معادل دلاری</CardDescription>
                    <CardTitle className="t-num-lg font-bold tracking-tight">
                      {walletTotalUsd != null ? `${formatUsd(walletTotalUsd)} $` : "—"}
                    </CardTitle>
                  </CardHeader>
                </div>
                <div className="stat-card">
                  <CardHeader className="pb-2">
                    <CardDescription>معادل طلای ۱۸ عیار</CardDescription>
                    <CardTitle className="t-num-lg font-bold tracking-tight">
                      {walletTotalGold18 != null
                        ? `${formatUsd(walletTotalGold18, 2)} گرم`
                        : "—"}
                    </CardTitle>
                  </CardHeader>
                </div>
              </div>

              <Card className="stat-card border-border/80 shadow-md">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle>موجودی دارایی‌ها</CardTitle>
                      <CardDescription>
                        مقدارها از API صرافی‌ها خوانده می‌شود؛ هر عددی که دستی وارد کنید جای مقدار
                        خودکار را می‌گیرد. برای طلای داخلی می‌توانید نرخ هر گرم را هم دستی بزنید.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void refreshWalletLive()}
                        title="خواندن دوباره موجودی از صرافی‌ها"
                      >
                        <RefreshCw className="size-3.5" />
                        موجودی
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setWallet({});
                          setWalletRates({});
                        }}
                        disabled={
                          !Object.keys(wallet).length && !Object.keys(walletRates).length
                        }
                      >
                        پاک کردن دستی‌ها
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-right">دارایی</th>
                        <th className="py-2 text-right">مقدار</th>
                        <th className="py-2 text-left">ارزش (تومان)</th>
                        <th className="py-2 text-left">سهم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WALLET_GROUPS.map((g) => {
                        const rows = walletRows.filter((r) => r.group === g.id);
                        const groupValue = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
                        return (
                          <Fragment key={g.id}>
                            <tr className="border-t border-border bg-muted/40">
                              <td className="py-2 text-right font-bold" colSpan={2}>
                                {g.fa}
                                <span className="mr-2 t-sm font-normal text-muted-foreground">
                                  {g.note}
                                </span>
                              </td>
                              <td className="t-num py-2 text-left font-bold">
                                {groupValue > 0 ? formatToman(groupValue) : "—"}
                              </td>
                              <td className="t-num py-2 text-left text-muted-foreground">
                                {walletTotal > 0 && groupValue > 0
                                  ? `${((groupValue / walletTotal) * 100).toFixed(1)}%`
                                  : "—"}
                              </td>
                            </tr>
                            {rows.map((r) => {
                              const share =
                                walletTotal > 0 && r.value != null
                                  ? (r.value / walletTotal) * 100
                                  : null;
                              return (
                                <tr key={r.id} className="border-b border-border/50">
                                  <td className="py-2 pr-4 text-right font-semibold">
                                    {r.fa}
                                    <span className="mr-1 t-sm text-muted-foreground">
                                      ({r.unit})
                                    </span>
                                  </td>
                                  <td className="py-2 text-right">
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      <label className="flex items-center gap-1 t-sm text-muted-foreground">
                                        <span>مقدار</span>
                                        <input
                                          className={cn(
                                            "t-num w-24 rounded-md border bg-background px-2 py-1 text-foreground",
                                            r.manualQty != null
                                              ? "border-border"
                                              : r.autoQty != null
                                                ? "border-primary/60"
                                                : "border-border"
                                          )}
                                          dir="ltr"
                                          inputMode="decimal"
                                          value={wallet[r.id] ?? ""}
                                          placeholder={
                                            r.autoQty != null ? formatUsd(r.autoQty, 4) : "0"
                                          }
                                          title={
                                            r.autoQty != null
                                              ? "از API صرافی خوانده می‌شود — برای بازنویسی عدد وارد کنید"
                                              : undefined
                                          }
                                          onChange={(e) => {
                                            const raw = e.target.value.replace(/[^0-9.]/g, "");
                                            setWallet((w) => {
                                              const next = { ...w };
                                              if (raw === "") delete next[r.id];
                                              else next[r.id] = Number(raw) || 0;
                                              return next;
                                            });
                                          }}
                                        />
                                      </label>
                                      {r.canSetRate ? (
                                        <label className="flex items-center gap-1 t-sm text-muted-foreground">
                                          <span>نرخ هر گرم</span>
                                          <input
                                            className={cn(
                                              "t-num w-36 rounded-md border bg-background px-2 py-1 text-foreground",
                                              r.manualPrice != null
                                                ? "border-primary/60"
                                                : "border-border"
                                            )}
                                            dir="ltr"
                                            inputMode="decimal"
                                            value={walletRates[r.id] ?? ""}
                                            placeholder={
                                              r.livePrice != null ? formatToman(r.livePrice) : "0"
                                            }
                                            onChange={(e) => {
                                              const raw = e.target.value.replace(/[^0-9.]/g, "");
                                              setWalletRates((w) => {
                                                const next = { ...w };
                                                if (raw === "") delete next[r.id];
                                                else next[r.id] = Number(raw) || 0;
                                                return next;
                                              });
                                            }}
                                          />
                                        </label>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="t-num py-2 text-left font-semibold">
                                    {r.value != null ? formatToman(r.value) : "—"}
                                    {r.manualQty == null && r.autoQty != null ? (
                                      <span className="mr-1 t-sm font-normal text-primary">
                                        خودکار
                                      </span>
                                    ) : null}
                                    {r.manualPrice != null ? (
                                      <span className="mr-1 t-sm font-normal text-primary">
                                        نرخ دستی
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="t-num py-2 text-left text-muted-foreground">
                                    {share != null ? `${share.toFixed(1)}%` : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                      <tr className="border-t border-primary/30 bg-primary/5">
                        <td className="py-2 text-right font-bold text-primary" colSpan={2}>
                          جمع کل
                        </td>
                        <td className="t-num py-2 text-left font-bold text-primary">
                          {formatToman(walletTotal)}
                        </td>
                        <td className="t-num py-2 text-left text-primary">
                          {walletTotal > 0 ? "100%" : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {!prices ? (
                    <p className="mt-3 t-sm text-warn">
                      نرخ زنده در دسترس نیست — مقادیر ذخیره می‌شوند ولی ارزش‌گذاری انجام نمی‌شود.
                    </p>
                  ) : null}
                  {walletLiveError ? (
                    <p className="mt-3 t-sm text-warn">
                      خواندن موجودی از صرافی‌ها ناموفق بود: {walletLiveError}
                    </p>
                  ) : null}
                  {walletLive?.connections?.length ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 t-sm text-muted-foreground">
                      <span>اتصال‌ها:</span>
                      {walletLive.connections.map((c) => (
                        <Badge key={c.id} variant={c.ok ? "live" : "danger"}>
                          {c.label}
                          {c.ok && c.value != null ? ` · ${formatUsd(c.value, 4)}` : ""}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 t-sm text-muted-foreground">
                      هنوز API صرافی ثبت نشده — از صفحه «منابع API» اتصال اضافه کنید تا موجودی خودکار
                      پر شود.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* ---- ARBITRAGE PAGES ---- */}
          {page === "usdt" && prices ? (
            <ArbitrageSection
              title="آربیتراژ تتر بین صرافی‌ها"
              subtitle="هر ردیف دفتر سفارش همان صرافی است — نرخ‌ها واقعاً از هم جدا هستند"
              unit="تتر"
              sides={usdtSides()}
              assets={["usdt"]}
              exchangeNames={exchangeNames}
            />
          ) : null}

          {page === "gold18" && prices ? (
            <ArbitrageSection
              title="آربیتراژ طلای ۱۸ عیار"
              subtitle="نرخ بازار داخلی در برابر ارزش طلای جهانی (تومان در هر گرم)"
              unit="گرم"
              sides={goldSides(18)}
              assets={["gold18dom", "gold18for"]}
              exchangeNames={exchangeNames}
            />
          ) : null}

          {page === "gold24" && prices ? (
            <ArbitrageSection
              title="آربیتراژ طلای ۲۴ عیار"
              subtitle="نرخ بازار داخلی در برابر ارزش طلای جهانی (تومان در هر گرم)"
              unit="گرم"
              sides={goldSides(24)}
              assets={["gold24dom", "gold24for"]}
              exchangeNames={exchangeNames}
            />
          ) : null}

          {page === "usd" && prices ? (
            <ArbitrageSection
              title="آربیتراژ دلار"
              subtitle={`دلار بازار آزاد در برابر ارزش ضمنی درهم (درهم × ${settings.aedPeg})`}
              unit="دلار"
              sides={usdSides()}
              assets={["usd"]}
              exchangeNames={exchangeNames}
            />
          ) : null}

          {page === "aed" && prices ? (
            <ArbitrageSection
              title="آربیتراژ درهم"
              subtitle={`درهم بازار آزاد در برابر ارزش منصفانه (دلار ÷ ${settings.aedPeg})`}
              unit="درهم"
              sides={aedSides()}
              assets={["aed"]}
              exchangeNames={exchangeNames}
            />
          ) : null}


          {/* ---- SOURCES ---- */}
          {page === "sources" ? (
            <div className="space-y-4">
              <WalletConnections
                exchanges={EXCHANGES.map((e) => ({ id: e.id, fa: e.fa }))}
                onChanged={() => void refreshWalletLive()}
              />
              <TradeConnectors exchanges={EXCHANGES.map((e) => ({ id: e.id, fa: e.fa }))} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardDescription>Navasan key</CardDescription>
                    <CardTitle>
                      {health?.navasanKey === "set" ? (
                        <Badge variant="live">set</Badge>
                      ) : (
                        <Badge variant="danger">missing</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>Proxy</CardDescription>
                    <CardTitle>
                      {health?.proxy ? (
                        <Badge variant="live">on</Badge>
                      ) : (
                        <Badge variant="muted">off</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>Refresh</CardDescription>
                    <CardTitle className="t-num">
                      {health?.refreshSec ?? "—"}s
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>گزارش providers</CardTitle>
                  <CardDescription>/api/debug</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {report.map((r) => (
                    <div
                      key={r.source}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div>
                        <div className="font-semibold">{r.label}</div>
                        {!r.ok && r.error ? (
                          <div className="max-w-xl truncate t-sm text-sell">{r.error}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {r.ms != null ? (
                          <span className="t-num t-sm text-muted-foreground">
                            {r.ms}ms
                          </span>
                        ) : null}
                        <Badge variant={r.ok ? "live" : "danger"}>{r.ok ? "OK" : "ERR"}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* ---- SETTINGS ---- */}
          {page === "settings" ? (
            <Card>
              <CardHeader>
                <CardTitle>پارامترهای محاسبه</CardTitle>
                <CardDescription>در localStorage مرورگر ذخیره می‌شود</CardDescription>
              </CardHeader>
              <CardContent className="grid max-w-lg gap-4">
                {(
                  [
                    ["aedPeg", "پابند درهم/دلار", settings.aedPeg],
                    ["purity", "عیار ۱۸ (۰.۷۵)", settings.purity],
                    ["troyOunce", "گرم در اونس تروی", settings.troyOunce],
                    ["refreshSec", "بازه UI refresh (ثانیه)", settings.refreshSec],
                  ] as const
                ).map(([key, label, val]) => (
                  <label key={key} className="block t-md">
                    <span className="text-muted-foreground">{label}</span>
                    <input
                      type="number"
                      step="any"
                      className="t-num mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                      dir="ltr"
                      value={val}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          [key]: Number(e.target.value) || s[key],
                        }))
                      }
                    />
                  </label>
                ))}
                <p className="t-sm text-muted-foreground">
                  کلید Navasan سرور-ساید است (فایل .env روی سرور: NAVASAN_API_KEY). برای دلار/درهم/طلای
                  free-market واقعی آن را ست کنید.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Separator />
          <footer className="flex flex-wrap items-center justify-between gap-2 pb-6 t-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Activity className="size-3.5" />
              shadcn/ui · همه صفحات قبلی · data از FastAPI
            </span>
            <span>Nobitex · Wallex · gold-api · CoinGecko · Navasan</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

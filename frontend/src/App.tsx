import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Coins,
  LayoutDashboard,
  RefreshCw,
  Settings as SettingsIcon,
  Sigma,
  Sparkles,
  Radio,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrices } from "@/hooks/usePrices";
import {
  DEFAULT_SETTINGS,
  EXCHANGES,
  FOREIGN_GOLD,
  avgOf,
  bubble,
  gold18FromKg,
  gold24FromKg,
  mapLiveModelToRates,
  pickBuy,
  pickSell,
  type RateEntry,
  type Settings,
} from "@/lib/market";
import { cn, formatToman, formatUsd, timeAgo } from "@/lib/utils";

type PageId =
  | "market"
  | "wallet"
  | "bubbles"
  | "formulas"
  | "b24dom"
  | "b24for"
  | "b18dom"
  | "b18for"
  | "baed"
  | "busd"
  | "alerts"
  | "settings"
  | "sources";

const PAGE_ROUTES: Record<PageId, string> = {
  market: "/market",
  wallet: "/wallet",
  bubbles: "/bubbles",
  formulas: "/formulas",
  b24dom: "/b24dom",
  b24for: "/b24for",
  b18dom: "/b18dom",
  b18for: "/b18for",
  baed: "/baed",
  busd: "/busd",
  alerts: "/alerts",
  settings: "/settings",
  sources: "/sources",
};

function pageFromPath(pathname: string): PageId {
  const p = pathname.replace(/\/+$/, "") || "/";
  const hit = (Object.entries(PAGE_ROUTES) as [PageId, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? "market";
}

const NAV: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "market", label: "مانیتورینگ بازار", icon: LayoutDashboard },
  { id: "wallet", label: "کیف پول", icon: Wallet },
  { id: "bubbles", label: "حباب‌ها", icon: Sparkles },
  { id: "formulas", label: "فرمول‌ها", icon: Sigma },
  { id: "b24dom", label: "آربیتراژ طلای ۲۴ داخلی", icon: Coins },
  { id: "b24for", label: "حباب طلای ۲۴ خارجی", icon: Coins },
  { id: "b18dom", label: "آربیتراژ طلای ۱۸ داخلی", icon: Coins },
  { id: "b18for", label: "حباب طلای ۱۸ خارجی", icon: Coins },
  { id: "baed", label: "حباب درهم", icon: Sparkles },
  { id: "busd", label: "حباب دلار", icon: Sparkles },
  { id: "alerts", label: "هشدارها", icon: Bell },
  { id: "sources", label: "منابع API", icon: Radio },
  { id: "settings", label: "تنظیمات", icon: SettingsIcon },
];

const PAGE_META: Record<PageId, { title: string; subtitle: string }> = {
  market: { title: "تابلوی بازار", subtitle: "قیمت لحظه‌ای طلا و صرافی‌ها از API" },
  wallet: { title: "کیف پول", subtitle: "موجودی دارایی‌ها و ارزش لحظه‌ای آن‌ها به تومان" },
  bubbles: { title: "حباب‌ها", subtitle: "نمای کلی حباب درهم، دلار، طلای ۱۸ و شمش ۲۴" },
  formulas: { title: "فرمول‌ها", subtitle: "مرجع همه فرمول‌های محاسباتی سامانه" },
  b24dom: { title: "آربیتراژ طلای ۲۴ عیار داخلی", subtitle: "فاصله هر صرافی از میانگین داخلی شمش ۲۴" },
  b24for: { title: "حباب طلای ۲۴ عیار خارجی", subtitle: "فاصله قیمت شمش با ارزش جهانی ۲۴ عیار" },
  b18dom: { title: "آربیتراژ طلای ۱۸ عیار داخلی", subtitle: "فاصله هر صرافی از میانگین داخلی ۱۸ عیار" },
  b18for: { title: "حباب طلای ۱۸ عیار خارجی", subtitle: "فاصله قیمت ۱۸ عیار با ارزش جهانی" },
  baed: { title: "حباب درهم", subtitle: "اختلاف درهم بازار با ارزش منصفانه (دلار ÷ پابند)" },
  busd: { title: "حباب دلار", subtitle: "اختلاف دلار بازار با ارزش ضمنی درهم" },
  alerts: { title: "هشدارهای قیمتی", subtitle: "مدیریت و پایش هشدارها (ذخیره در مرورگر)" },
  settings: { title: "تنظیمات سامانه", subtitle: "پیکربندی پارامترها" },
  sources: { title: "منابع API", subtitle: "وضعیت زنده هر provider از بک‌اند" },
};

type Alert = {
  id: string;
  asset: "dollar" | "usdt" | "aed" | "gold18" | "ounce";
  cond: "above" | "below";
  value: number;
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

/** کیف پول قدیمی یک ردیف طلا داشت — به نسخه داخلی منتقل می‌شود. */
function migrateWallet(raw: Record<string, number>): Record<string, number> {
  const w = { ...raw };
  if (w.gold18 != null && w.gold18dom == null) w.gold18dom = w.gold18;
  if (w.gold24 != null && w.gold24dom == null) w.gold24dom = w.gold24;
  delete w.gold18;
  delete w.gold24;
  return w;
}

function BuySell({ buy, sell }: { buy?: number | null; sell?: number | null }) {
  if (buy == null && sell == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="t-num flex flex-col items-end gap-0.5 t-md">
      <span className="text-buy">{formatToman(buy ?? null)}</span>
      <span className="text-sell">{formatToman(sell ?? null)}</span>
    </div>
  );
}

function pctColor(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct > 0.15) return "text-sell";
  if (pct < -0.15) return "text-buy";
  return "text-muted-foreground";
}

export default function App() {
  const { prices, health, report, error, loading, updatedAt, refresh } = usePrices();
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
  const [alerts, setAlerts] = useState<Alert[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gb-alerts") || "[]");
    } catch {
      return [];
    }
  });
  const [alertAsset, setAlertAsset] = useState<Alert["asset"]>("dollar");
  const [alertCond, setAlertCond] = useState<Alert["cond"]>("above");
  const [alertValue, setAlertValue] = useState("");
  const [wallet, setWallet] = useState<Record<string, number>>(() => {
    try {
      return migrateWallet(JSON.parse(localStorage.getItem("gb-wallet") || "{}"));
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem("gb-settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("gb-alerts", JSON.stringify(alerts));
  }, [alerts]);
  useEffect(() => {
    localStorage.setItem("gb-wallet", JSON.stringify(wallet));
  }, [wallet]);

  const { rates, tags } = useMemo(
    () => (prices ? mapLiveModelToRates(prices) : { rates: {}, tags: {} }),
    [prices]
  );

  const ounceUsd = prices?.ounceUsd ?? null;
  const usdSells = EXCHANGES.map((e) => pickSell(rates[e.id]?.usd)).filter((v): v is number => v != null);
  const avgUsdSell = avgOf(usdSells);
  const avgUsdBuy = avgOf(
    EXCHANGES.map((e) => pickBuy(rates[e.id]?.usd)).filter((v): v is number => v != null)
  );
  const domAvg18 = avgOf(
    EXCHANGES.map((e) => pickSell(rates[e.id]?.gold18)).filter((v): v is number => v != null)
  );
  const domAvg24 = avgOf(
    EXCHANGES.map((e) => pickSell(rates[e.id]?.shemsh24)).filter((v): v is number => v != null)
  );

  const marketUsd = pickSell(prices?.market?.usd) ?? avgUsdSell;
  const marketAed = pickSell(prices?.market?.aed);
  const fairAed = marketUsd != null ? Math.round(marketUsd / settings.aedPeg) : null;
  const fairUsdFromAed = marketAed != null ? Math.round(marketAed * settings.aedPeg) : null;

  const usdtSell =
    pickSell(prices?.usdtByExchange?.nobitex) ?? pickSell(prices?.usdtByExchange?.wallex);

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
    const qty = Number(wallet[a.id]) || 0;
    const unitPrice = walletUnitPrice(a.id);
    const value = unitPrice != null ? qty * unitPrice : null;
    return { ...a, qty, unitPrice, value };
  });
  const walletTotal = walletRows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const walletTotalUsd = marketUsd ? walletTotal / marketUsd : null;
  const gold18Gram = walletUnitPrice("gold18dom");
  const walletTotalGold18 = gold18Gram ? walletTotal / gold18Gram : null;

  const alertPrice = (asset: Alert["asset"]): number | null => {
    if (asset === "ounce") return ounceUsd;
    if (asset === "dollar") return marketUsd;
    if (asset === "aed") return marketAed;
    if (asset === "usdt")
      return (
        pickSell(prices?.usdtByExchange?.nobitex) ??
        pickSell(prices?.usdtByExchange?.wallex)
      );
    if (asset === "gold18") {
      const kg = pickSell(prices?.market?.gold18PerKg);
      return kg != null ? kg / 1000 : null;
    }
    return null;
  };

  const alertTriggered = (a: Alert) => {
    const p = alertPrice(a.asset);
    if (p == null) return false;
    return a.cond === "above" ? p >= a.value : p <= a.value;
  };

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
            const badge =
              item.id === "alerts" ? alerts.filter(alertTriggered).length : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={cn("nav-item", active ? "nav-item-active" : "nav-item-idle")}
              >
                <Icon className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
                <span className="flex-1">{item.label}</span>
                {badge > 0 ? (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--sell)_20%,transparent)] px-1.5 t-sm font-bold text-sell">
                    {badge}
                  </span>
                ) : null}
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

          {/* ---- MARKET ---- */}
          {page === "market" && prices ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["انس جهانی", formatUsd(ounceUsd) + " $", null as string | null],
                    [
                      "دلار بازار",
                      formatToman(marketUsd),
                      prices.estimated?.usd ? "est" : "live",
                    ],
                    [
                      "تتر نوبیتکس",
                      formatToman(pickSell(prices.usdtByExchange?.nobitex)),
                      "live",
                    ],
                    [
                      "تتر والکس",
                      formatToman(pickSell(prices.usdtByExchange?.wallex)),
                      "live",
                    ],
                  ] as const
                ).map(([label, value, badge]) => (
                  <div key={label} className="stat-card">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardDescription>{label}</CardDescription>
                        {badge === "live" ? <Badge variant="live">زنده</Badge> : null}
                        {badge === "est" ? <Badge variant="est">تخمینی</Badge> : null}
                      </div>
                      <CardTitle className="t-num-lg font-bold tracking-tight">
                        {value}
                      </CardTitle>
                    </CardHeader>
                  </div>
                ))}
              </div>

              <Card className="stat-card border-border/80 shadow-md">
                <CardHeader>
                  <CardTitle>قیمت به تومان — همه صرافی‌ها</CardTitle>
                  <CardDescription>
                    داده زنده از بک‌اند · نوبیتکس تا تترلند + بن‌بست/نوسان
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {EXCHANGES.map((ex) => {
                      const r: RateEntry = rates[ex.id] || {};
                      const tag = tags[ex.id];
                      const has = tag?.state === "live";
                      const melt18 = gold18FromKg(
                        pickSell(r.usd) ?? marketUsd,
                        ounceUsd,
                        settings.troyOunce,
                        settings.purity
                      );
                      return (
                        <div key={ex.id} className="ex-tile">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-bold">{ex.fa}</span>
                            {has ? (
                              <Badge variant={tag?.estimated ? "est" : "live"}>
                                {tag?.estimated ? "تخمینی" : "زنده"}:{" "}
                                {(tag?.liveKeys || [])
                                  .map((k) =>
                                    k === "usdt"
                                      ? "تتر"
                                      : k === "usd"
                                        ? "دلار"
                                        : k === "aed"
                                          ? "درهم"
                                          : k === "gold18"
                                            ? "۱۸"
                                            : k === "shemsh24"
                                              ? "۲۴"
                                              : k
                                  )
                                  .join("، ")}
                              </Badge>
                            ) : (
                              <Badge variant="muted">بدون داده</Badge>
                            )}
                          </div>
                          <table className="data-table">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="py-1 text-right font-medium" />
                                <th className="py-1 text-left font-medium text-buy">خرید</th>
                                <th className="py-1 text-left font-medium text-sell">فروش</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(
                                [
                                  ["دلار", r.usd],
                                  ["تتر", r.usdt],
                                  ["درهم", r.aed],
                                  ["طلای ۱۸ (کیلو)", r.gold18],
                                  ["شمش ۲۴ (کیلو)", r.shemsh24],
                                ] as const
                              ).map(([label, pair]) => (
                                <tr key={label} className="border-t border-border/50">
                                  <td className="py-1.5 text-right text-muted-foreground">
                                    {label}
                                  </td>
                                  <td className="t-num py-1.5 text-left text-buy">
                                    {formatToman(pair?.buy ?? null)}
                                  </td>
                                  <td className="t-num py-1.5 text-left text-sell">
                                    {formatToman(pair?.sell ?? null)}
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t border-primary/30 bg-primary/5">
                                <td className="py-1.5 text-right text-primary">تبدیل طلای جهانی ۱۸</td>
                                <td
                                  className="t-num py-1.5 text-left text-primary"
                                  colSpan={2}
                                >
                                  {formatToman(melt18 != null ? Math.round(melt18) : null)} /کیلو
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
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
                        مقدار هر دارایی را وارد کنید — ارزش با نرخ زنده بازار محاسبه و در مرورگر ذخیره
                        می‌شود
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setWallet({})}
                      disabled={walletRows.every((r) => !r.qty)}
                    >
                      خالی کردن
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-right">دارایی</th>
                        <th className="py-2 text-right">مقدار</th>
                        <th className="py-2 text-left">نرخ واحد (تومان)</th>
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
                              <td className="py-2 text-right font-bold" colSpan={3}>
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
                                    <input
                                      className="t-num w-32 rounded-md border border-border bg-background px-2 py-1"
                                      dir="ltr"
                                      inputMode="decimal"
                                      value={wallet[r.id] ?? ""}
                                      placeholder="0"
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
                                  </td>
                                  <td className="t-num py-2 text-left text-muted-foreground">
                                    {r.unitPrice != null ? formatToman(r.unitPrice) : "—"}
                                  </td>
                                  <td className="t-num py-2 text-left font-semibold">
                                    {r.value != null ? formatToman(r.value) : "—"}
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
                        <td className="py-2 text-right font-bold text-primary" colSpan={3}>
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
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* ---- BUBBLES overview ---- */}
          {page === "bubbles" && prices ? (
            <div className="grid gap-3 md:grid-cols-2">
              {EXCHANGES.filter((e) => tags[e.id]?.state === "live").map((ex) => {
                const r = rates[ex.id] || {};
                const usd = pickSell(r.usd);
                const aed = pickSell(r.aed);
                const g18 = pickSell(r.gold18);
                const fairA = usd != null ? usd / settings.aedPeg : null;
                const bAed = bubble(aed, fairA);
                const melt = gold18FromKg(usd, ounceUsd, settings.troyOunce, settings.purity);
                const bGold = bubble(g18, melt);
                return (
                  <Card key={ex.id}>
                    <CardHeader>
                      <CardTitle>{ex.fa}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 t-md">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">حباب درهم</span>
                        <span className={cn("t-num", pctColor(bAed.pct))}>
                          {bAed.pct != null ? `${bAed.pct.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">حباب طلای ۱۸ (خارجی)</span>
                        <span className={cn("t-num", pctColor(bGold.pct))}>
                          {bGold.pct != null ? `${bGold.pct.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">فاصله ۱۸ از میانگین داخلی</span>
                        <span className="t-num">
                          {g18 != null && domAvg18 != null
                            ? `${(((g18 - domAvg18) / domAvg18) * 100).toFixed(2)}%`
                            : "—"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {!EXCHANGES.some((e) => tags[e.id]?.state === "live") ? (
                <p className="text-muted-foreground">هنوز داده زنده‌ای نیست.</p>
              ) : null}
            </div>
          ) : null}

          {/* ---- 24k domestic arb ---- */}
          {page === "b24dom" && prices ? (
            <Card>
              <CardHeader>
                <CardTitle>آربیتراژ شمش ۲۴ داخلی</CardTitle>
                <CardDescription>
                  میانگین داخلی فروش: {formatToman(domAvg24)} تومان/کیلو
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 text-right">صرافی</th>
                      <th className="py-2 text-left">فروش ۲۴</th>
                      <th className="py-2 text-left">Δ از میانگین</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXCHANGES.map((ex) => {
                      const sell = pickSell(rates[ex.id]?.shemsh24);
                      const pct =
                        sell != null && domAvg24 ? ((sell - domAvg24) / domAvg24) * 100 : null;
                      return (
                        <tr key={ex.id} className="border-b border-border/50">
                          <td className="py-2 text-right font-semibold">{ex.fa}</td>
                          <td className="t-num py-2 text-left">{formatToman(sell)}</td>
                          <td className={cn("t-num py-2 text-left", pctColor(pct))}>
                            {pct != null ? `${pct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* ---- 24k foreign (live global sources) ---- */}
          {page === "b24for" && prices ? (
            <Card className="stat-card">
              <CardHeader>
                <CardTitle>حباب طلای ۲۴ عیار خارجی</CardTitle>
                <CardDescription>
                  انس × دلار ÷ {settings.troyOunce} × ۱۰۰۰ · دلار مرجع {formatToman(marketUsd)}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-right">منبع خارجی</th>
                      <th className="text-left">قیمت اونس ($)</th>
                      <th className="text-left">معادل ۲۴ (کیلو)</th>
                      <th className="text-left">میانگین ۲۴ داخلی</th>
                      <th className="text-left">حباب ٪</th>
                      <th className="text-left">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FOREIGN_GOLD.map((src) => {
                      const liveVal =
                        "coinId" in src && src.coinId
                          ? prices.foreignGold?.[src.coinId] ?? null
                          : ounceUsd;
                      const usdOunce =
                        typeof liveVal === "number" && liveVal > 0 ? liveVal : null;
                      const eq24 = gold24FromKg(marketUsd, usdOunce, settings.troyOunce);
                      const b = bubble(eq24, domAvg24);
                      const isReal = usdOunce != null;
                      return (
                        <tr key={src.name}>
                          <td className="text-right font-semibold">{src.name}</td>
                          <td className="t-num text-left">
                            {usdOunce != null ? formatUsd(usdOunce) : "—"}
                          </td>
                          <td className="t-num text-left">
                            {formatToman(eq24 != null ? Math.round(eq24) : null)}
                          </td>
                          <td className="t-num text-left">{formatToman(domAvg24)}</td>
                          <td className={cn("t-num text-left", pctColor(b.pct))}>
                            {b.pct != null ? `${b.pct >= 0 ? "+" : ""}${b.pct.toFixed(2)}%` : "—"}
                          </td>
                          <td className="text-left">
                            {isReal ? (
                              <Badge variant="live">زنده</Badge>
                            ) : (
                              <Badge variant="danger">بدون داده</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* ---- 18k domestic ---- */}
          {page === "b18dom" && prices ? (
            <Card>
              <CardHeader>
                <CardTitle>آربیتراژ طلای ۱۸ داخلی</CardTitle>
                <CardDescription>میانگین فروش: {formatToman(domAvg18)}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 text-right">صرافی</th>
                      <th className="py-2 text-left">فروش ۱۸</th>
                      <th className="py-2 text-left">Δ ٪</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXCHANGES.map((ex) => {
                      const sell = pickSell(rates[ex.id]?.gold18);
                      const pct =
                        sell != null && domAvg18 ? ((sell - domAvg18) / domAvg18) * 100 : null;
                      return (
                        <tr key={ex.id} className="border-b border-border/50">
                          <td className="py-2 text-right font-semibold">{ex.fa}</td>
                          <td className="t-num py-2 text-left">{formatToman(sell)}</td>
                          <td className={cn("t-num py-2 text-left", pctColor(pct))}>
                            {pct != null ? `${pct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* ---- 18k foreign (live global sources) ---- */}
          {page === "b18for" && prices ? (
            <Card className="stat-card">
              <CardHeader>
                <CardTitle>حباب طلای ۱۸ عیار خارجی</CardTitle>
                <CardDescription>
                  انس × دلار ÷ {settings.troyOunce} × {settings.purity} × ۱۰۰۰
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-right">منبع خارجی</th>
                      <th className="text-left">قیمت اونس ($)</th>
                      <th className="text-left">معادل ۱۸ (کیلو)</th>
                      <th className="text-left">میانگین ۱۸ داخلی</th>
                      <th className="text-left">حباب ٪</th>
                      <th className="text-left">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FOREIGN_GOLD.map((src) => {
                      const liveVal =
                        "coinId" in src && src.coinId
                          ? prices.foreignGold?.[src.coinId] ?? null
                          : ounceUsd;
                      const usdOunce =
                        typeof liveVal === "number" && liveVal > 0 ? liveVal : null;
                      const eq18 = gold18FromKg(
                        marketUsd,
                        usdOunce,
                        settings.troyOunce,
                        settings.purity
                      );
                      const b = bubble(eq18, domAvg18);
                      const isReal = usdOunce != null;
                      return (
                        <tr key={src.name}>
                          <td className="text-right font-semibold">{src.name}</td>
                          <td className="t-num text-left">
                            {usdOunce != null ? formatUsd(usdOunce) : "—"}
                          </td>
                          <td className="t-num text-left">
                            {formatToman(eq18 != null ? Math.round(eq18) : null)}
                          </td>
                          <td className="t-num text-left">{formatToman(domAvg18)}</td>
                          <td className={cn("t-num text-left", pctColor(b.pct))}>
                            {b.pct != null ? `${b.pct >= 0 ? "+" : ""}${b.pct.toFixed(2)}%` : "—"}
                          </td>
                          <td className="text-left">
                            {isReal ? (
                              <Badge variant="live">زنده</Badge>
                            ) : (
                              <Badge variant="danger">بدون داده</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* ---- AED bubble ---- */}
          {page === "baed" && prices ? (
            <Card>
              <CardHeader>
                <CardTitle>حباب درهم</CardTitle>
                <CardDescription>
                  منصفانه = دلار ÷ {settings.aedPeg} · میانگین دلار فروش {formatToman(avgUsdSell)}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 text-right">صرافی</th>
                      <th className="py-2 text-left">درهم فروش</th>
                      <th className="py-2 text-left">منصفانه</th>
                      <th className="py-2 text-left">حباب ٪</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXCHANGES.map((ex) => {
                      const aed = pickSell(rates[ex.id]?.aed);
                      const usd = pickSell(rates[ex.id]?.usd) ?? marketUsd;
                      const fair = usd != null ? usd / settings.aedPeg : null;
                      const b = bubble(aed, fair);
                      return (
                        <tr key={ex.id} className="border-b border-border/50">
                          <td className="py-2 text-right font-semibold">{ex.fa}</td>
                          <td className="t-num py-2 text-left">{formatToman(aed)}</td>
                          <td className="t-num py-2 text-left">
                            {formatToman(fair != null ? Math.round(fair) : null)}
                          </td>
                          <td className={cn("t-num py-2 text-left", pctColor(b.pct))}>
                            {b.pct != null ? `${b.pct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* ---- USD bubble ---- */}
          {page === "busd" && prices ? (
            <Card>
              <CardHeader>
                <CardTitle>حباب دلار</CardTitle>
                <CardDescription>ضمنی = درهم × {settings.aedPeg}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 text-right">صرافی</th>
                      <th className="py-2 text-left">دلار فروش</th>
                      <th className="py-2 text-left">ضمنی از درهم</th>
                      <th className="py-2 text-left">حباب ٪</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXCHANGES.map((ex) => {
                      const usd = pickSell(rates[ex.id]?.usd);
                      const aed = pickSell(rates[ex.id]?.aed);
                      const impl = aed != null ? aed * settings.aedPeg : null;
                      const b = bubble(usd, impl);
                      return (
                        <tr key={ex.id} className="border-b border-border/50">
                          <td className="py-2 text-right font-semibold">{ex.fa}</td>
                          <td className="t-num py-2 text-left">{formatToman(usd)}</td>
                          <td className="t-num py-2 text-left">
                            {formatToman(impl != null ? Math.round(impl) : null)}
                          </td>
                          <td className={cn("t-num py-2 text-left", pctColor(b.pct))}>
                            {b.pct != null ? `${b.pct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {marketAed == null ? (
                  <p className="mt-3 t-sm text-warn">
                    درهم زنده نیست — برای حباب دلار دقیق، NAVASAN_API_KEY لازم است.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* ---- FORMULAS (full reference + live values) ---- */}
          {page === "formulas" && prices ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>قیمت واقعی درهم</CardTitle>
                    <CardDescription>دلار ÷ {settings.aedPeg}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="t-num t-md text-muted-foreground">
                      {formatToman(marketUsd)} ÷ {settings.aedPeg}
                    </div>
                    <div className="t-num mt-1 t-num-lg font-bold text-primary">
                      {formatToman(fairAed)} تومان
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>قیمت واقعی دلار</CardTitle>
                    <CardDescription>درهم × {settings.aedPeg}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="t-num t-md text-muted-foreground">
                      {formatToman(marketAed)} × {settings.aedPeg}
                    </div>
                    <div className="t-num mt-1 t-num-lg font-bold text-primary">
                      {formatToman(fairUsdFromAed)} تومان
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>تبدیل طلای جهانی → ۱۸ داخلی</CardTitle>
                    <CardDescription>
                      (انس × دلار ÷ {settings.troyOunce}) × {settings.purity} × ۱۰۰۰
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="t-num t-num-lg font-bold">
                      {formatToman(
                        Math.round(
                          gold18FromKg(
                            marketUsd,
                            ounceUsd,
                            settings.troyOunce,
                            settings.purity
                          ) || 0
                        ) || null
                      )}{" "}
                      /کیلو
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>تبدیل طلای جهانی → ۲۴</CardTitle>
                    <CardDescription>
                      انس × دلار ÷ {settings.troyOunce} × ۱۰۰۰
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="t-num t-num-lg font-bold">
                      {formatToman(
                        Math.round(
                          gold24FromKg(marketUsd, ounceUsd, settings.troyOunce) || 0
                        ) || null
                      )}{" "}
                      /کیلو
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>مرجع فرمول‌ها</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 t-md leading-8 text-muted-foreground">
                  <p>حباب درهم = درهم بازار − (دلار ÷ {settings.aedPeg})</p>
                  <p>حباب دلار = دلار بازار − (درهم × {settings.aedPeg})</p>
                  <p>آربیتراژ طلای داخلی = قیمت صرافی − میانگین همان کالا بین صرافی‌ها</p>
                  <p>
                    حباب طلای خارجی = قیمت صرافی − (انس × دلار ÷ {settings.troyOunce} × عیار ×
                    ۱۰۰۰)
                  </p>
                  <p>
                    مقادیر جاری: پابند={settings.aedPeg} · عیار={settings.purity} · troy=
                    {settings.troyOunce} · انس={formatUsd(ounceUsd)} · میانگین دلار خرید=
                    {formatToman(avgUsdBuy)} · فروش={formatToman(avgUsdSell)}
                  </p>
                  <p>
                    PAXG={formatUsd(prices.foreignGold?.["pax-gold"])} · XAUT=
                    {formatUsd(prices.foreignGold?.["tether-gold"])}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* ---- ALERTS ---- */}
          {page === "alerts" ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>ساخت هشدار</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <label className="t-md">
                    دارایی
                    <select
                      className="mt-1 block rounded-md border border-border bg-background px-3 py-2"
                      value={alertAsset}
                      onChange={(e) => setAlertAsset(e.target.value as Alert["asset"])}
                    >
                      <option value="dollar">دلار</option>
                      <option value="usdt">تتر</option>
                      <option value="aed">درهم</option>
                      <option value="gold18">طلای ۱۸ (گرم)</option>
                      <option value="ounce">انس</option>
                    </select>
                  </label>
                  <label className="t-md">
                    شرط
                    <select
                      className="mt-1 block rounded-md border border-border bg-background px-3 py-2"
                      value={alertCond}
                      onChange={(e) => setAlertCond(e.target.value as Alert["cond"])}
                    >
                      <option value="above">بالاتر از</option>
                      <option value="below">پایین‌تر از</option>
                    </select>
                  </label>
                  <label className="t-md">
                    مقدار
                    <input
                      className="t-num mt-1 block rounded-md border border-border bg-background px-3 py-2"
                      value={alertValue}
                      onChange={(e) => setAlertValue(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="مثلا 190000"
                      dir="ltr"
                    />
                  </label>
                  <Button
                    onClick={() => {
                      const v = Number(alertValue);
                      if (!v) return;
                      setAlerts((a) => [
                        ...a,
                        {
                          id: crypto.randomUUID(),
                          asset: alertAsset,
                          cond: alertCond,
                          value: v,
                        },
                      ]);
                      setAlertValue("");
                    }}
                  >
                    افزودن
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>لیست هشدارها</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alerts.length === 0 ? (
                    <p className="t-md text-muted-foreground">هشداری نیست.</p>
                  ) : (
                    alerts.map((a) => {
                      const on = alertTriggered(a);
                      const cur = alertPrice(a.asset);
                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
                            on ? "border-[color-mix(in_srgb,var(--sell)_45%,transparent)] bg-[color-mix(in_srgb,var(--sell)_10%,transparent)]" : "border-border"
                          )}
                        >
                          <div className="t-md">
                            <span className="font-semibold">{a.asset}</span>{" "}
                            {a.cond === "above" ? "≥" : "≤"}{" "}
                            <span className="t-num">{formatToman(a.value)}</span>
                            <span className="mr-2 text-muted-foreground">
                              · فعلی: {formatToman(cur)}
                            </span>
                            {on ? <Badge variant="danger">فعال</Badge> : null}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAlerts((xs) => xs.filter((x) => x.id !== a.id))}
                          >
                            حذف
                          </Button>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* ---- SOURCES ---- */}
          {page === "sources" ? (
            <div className="space-y-4">
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

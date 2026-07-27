import { useEffect, useMemo, useState } from "react";
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

function BuySell({ buy, sell }: { buy?: number | null; sell?: number | null }) {
  if (buy == null && sell == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="font-mono-nums flex flex-col items-end gap-0.5 text-sm">
      <span className="text-emerald-400">{formatToman(buy ?? null)}</span>
      <span className="text-red-400">{formatToman(sell ?? null)}</span>
    </div>
  );
}

function pctColor(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct > 0.15) return "text-red-400";
  if (pct < -0.15) return "text-emerald-400";
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

  useEffect(() => {
    localStorage.setItem("gb-settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("gb-alerts", JSON.stringify(alerts));
  }, [alerts]);

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
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
      />

      <aside className="app-sidebar">
        <div className="flex items-center gap-3 border-b border-border/80 px-4 py-5">
          <div className="logo-mark">﷼</div>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">تابلوی بازار</div>
            <div className="font-mono-nums text-[10px] text-muted-foreground">
              v{prices?.version || health?.version || "—"}
              {(prices?.gitSha || health?.gitSha) &&
                ` · ${String(prices?.gitSha || health?.gitSha).slice(0, 7)}`}
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
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
                <Icon className="size-4 shrink-0 opacity-90" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 ? (
                  <span className="rounded-full bg-red-500/25 px-1.5 text-[10px] font-bold text-red-400">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-border/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
          shadcn/ui · داده زنده از FastAPI
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div>
            <h1 className="bg-gradient-to-l from-primary/90 to-foreground bg-clip-text text-xl font-extrabold tracking-tight text-transparent sm:text-2xl">
              {meta.title}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{meta.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {prices && !prices.stale ? <Badge variant="live">● زنده</Badge> : null}
            {prices?.stale ? <Badge variant="est">● آخرین معتبر</Badge> : null}
            {error && !prices ? <Badge variant="danger">● خطا</Badge> : null}
            {!prices && !error && loading ? <Badge variant="muted">در حال بارگذاری</Badge> : null}
            <span className="text-xs text-muted-foreground">بروزرسانی: {timeAgo(updatedAt)}</span>
            <Button size="sm" onClick={() => void onRefresh()} disabled={busy}>
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              بروزرسانی
            </Button>
          </div>
        </header>

        <main className="space-y-5 p-4 sm:p-6">
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
                      <CardTitle className="font-mono-nums text-2xl tracking-tight">
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
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="py-1 text-right font-medium" />
                                <th className="py-1 text-left font-medium text-emerald-400">خرید</th>
                                <th className="py-1 text-left font-medium text-red-400">فروش</th>
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
                                  <td className="font-mono-nums py-1.5 text-left text-emerald-400">
                                    {formatToman(pair?.buy ?? null)}
                                  </td>
                                  <td className="font-mono-nums py-1.5 text-left text-red-400">
                                    {formatToman(pair?.sell ?? null)}
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t border-primary/30 bg-primary/5">
                                <td className="py-1.5 text-right text-primary">تبدیل طلای جهانی ۱۸</td>
                                <td
                                  className="font-mono-nums py-1.5 text-left text-primary"
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
                    <CardContent className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">حباب درهم</span>
                        <span className={cn("font-mono-nums", pctColor(bAed.pct))}>
                          {bAed.pct != null ? `${bAed.pct.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">حباب طلای ۱۸ (خارجی)</span>
                        <span className={cn("font-mono-nums", pctColor(bGold.pct))}>
                          {bGold.pct != null ? `${bGold.pct.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">فاصله ۱۸ از میانگین داخلی</span>
                        <span className="font-mono-nums">
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
                <table className="w-full text-sm">
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
                          <td className="font-mono-nums py-2 text-left">{formatToman(sell)}</td>
                          <td className={cn("font-mono-nums py-2 text-left", pctColor(pct))}>
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
                          <td className="font-mono-nums text-left">
                            {usdOunce != null ? formatUsd(usdOunce) : "—"}
                          </td>
                          <td className="font-mono-nums text-left">
                            {formatToman(eq24 != null ? Math.round(eq24) : null)}
                          </td>
                          <td className="font-mono-nums text-left">{formatToman(domAvg24)}</td>
                          <td className={cn("font-mono-nums text-left", pctColor(b.pct))}>
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
                <table className="w-full text-sm">
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
                          <td className="font-mono-nums py-2 text-left">{formatToman(sell)}</td>
                          <td className={cn("font-mono-nums py-2 text-left", pctColor(pct))}>
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
                          <td className="font-mono-nums text-left">
                            {usdOunce != null ? formatUsd(usdOunce) : "—"}
                          </td>
                          <td className="font-mono-nums text-left">
                            {formatToman(eq18 != null ? Math.round(eq18) : null)}
                          </td>
                          <td className="font-mono-nums text-left">{formatToman(domAvg18)}</td>
                          <td className={cn("font-mono-nums text-left", pctColor(b.pct))}>
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
                <table className="w-full text-sm">
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
                          <td className="font-mono-nums py-2 text-left">{formatToman(aed)}</td>
                          <td className="font-mono-nums py-2 text-left">
                            {formatToman(fair != null ? Math.round(fair) : null)}
                          </td>
                          <td className={cn("font-mono-nums py-2 text-left", pctColor(b.pct))}>
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
                <table className="w-full text-sm">
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
                          <td className="font-mono-nums py-2 text-left">{formatToman(usd)}</td>
                          <td className="font-mono-nums py-2 text-left">
                            {formatToman(impl != null ? Math.round(impl) : null)}
                          </td>
                          <td className={cn("font-mono-nums py-2 text-left", pctColor(b.pct))}>
                            {b.pct != null ? `${b.pct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {marketAed == null ? (
                  <p className="mt-3 text-xs text-amber-400">
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
                    <div className="font-mono-nums text-sm text-muted-foreground">
                      {formatToman(marketUsd)} ÷ {settings.aedPeg}
                    </div>
                    <div className="font-mono-nums mt-1 text-2xl font-bold text-primary">
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
                    <div className="font-mono-nums text-sm text-muted-foreground">
                      {formatToman(marketAed)} × {settings.aedPeg}
                    </div>
                    <div className="font-mono-nums mt-1 text-2xl font-bold text-primary">
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
                    <div className="font-mono-nums text-2xl font-bold">
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
                    <div className="font-mono-nums text-2xl font-bold">
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
                <CardContent className="space-y-2 text-sm leading-8 text-muted-foreground">
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
                  <label className="text-sm">
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
                  <label className="text-sm">
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
                  <label className="text-sm">
                    مقدار
                    <input
                      className="font-mono-nums mt-1 block rounded-md border border-border bg-background px-3 py-2"
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
                    <p className="text-sm text-muted-foreground">هشداری نیست.</p>
                  ) : (
                    alerts.map((a) => {
                      const on = alertTriggered(a);
                      const cur = alertPrice(a.asset);
                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
                            on ? "border-red-500/50 bg-red-500/10" : "border-border"
                          )}
                        >
                          <div className="text-sm">
                            <span className="font-semibold">{a.asset}</span>{" "}
                            {a.cond === "above" ? "≥" : "≤"}{" "}
                            <span className="font-mono-nums">{formatToman(a.value)}</span>
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
                    <CardTitle className="font-mono-nums">
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
                          <div className="max-w-xl truncate text-xs text-red-400">{r.error}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {r.ms != null ? (
                          <span className="font-mono-nums text-xs text-muted-foreground">
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
                  <label key={key} className="block text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <input
                      type="number"
                      step="any"
                      className="font-mono-nums mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
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
                <p className="text-xs text-muted-foreground">
                  کلید Navasan سرور-ساید است (فایل .env روی سرور: NAVASAN_API_KEY). برای دلار/درهم/طلای
                  free-market واقعی آن را ست کنید.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Separator />
          <footer className="flex flex-wrap items-center justify-between gap-2 pb-6 text-xs text-muted-foreground">
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

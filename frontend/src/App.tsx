import { useMemo, useState } from "react";
import {
  Activity,
  Coins,
  LayoutDashboard,
  RefreshCw,
  Sigma,
  Radio,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EXCHANGE_META, type ExchangeRow, type Pair, type PriceModel } from "@/lib/api";
import { formatToman, formatUsd, timeAgo, cn } from "@/lib/utils";
import { usePrices } from "@/hooks/usePrices";

function pairMid(p?: Pair | null): number | null {
  if (!p) return null;
  if (p.latest != null) return p.latest;
  if (p.buy != null && p.sell != null) return (p.buy + p.sell) / 2;
  return p.buy ?? p.sell ?? null;
}

function BuySell({ pair }: { pair?: Pair | null }) {
  if (!pair || (pair.buy == null && pair.sell == null)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="font-mono-nums flex flex-col items-end gap-0.5 text-sm">
      <span className="text-emerald-400">{formatToman(pair.buy ?? null)}</span>
      <span className="text-red-400">{formatToman(pair.sell ?? null)}</span>
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  estimated,
}: {
  title: string;
  value: string;
  hint?: string;
  estimated?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{title}</CardDescription>
          {estimated ? <Badge variant="est">تخمینی</Badge> : <Badge variant="live">زنده</Badge>}
        </div>
        <CardTitle className="font-mono-nums pt-1 text-2xl tracking-tight">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

function MarketBoard({ prices }: { prices: PriceModel }) {
  const exchanges = prices.exchanges || {};
  const liveIds = EXCHANGE_META.filter((e) => {
    const row = exchanges[e.id];
    if (!row) return false;
    return Object.values(row).some((v) => v != null);
  });
  const emptyIds = EXCHANGE_META.filter((e) => !liveIds.find((x) => x.id === e.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="انس جهانی (USD)"
          value={formatUsd(prices.ounceUsd)}
          hint={prices.sources?.ounce?.source || "gold-api"}
          estimated={false}
        />
        <StatCard
          title="دلار (تومان)"
          value={formatToman(prices.market?.usd?.sell ?? prices.market?.usd?.buy)}
          hint={prices.estimated?.usd ? "USDT proxy / Navasan" : "Navasan"}
          estimated={!!prices.estimated?.usd}
        />
        <StatCard
          title="تتر نوبیتکس"
          value={formatToman(pairMid(prices.usdtByExchange?.nobitex))}
          hint="Nobitex depth"
          estimated={false}
        />
        <StatCard
          title="تتر والکس"
          value={formatToman(pairMid(prices.usdtByExchange?.wallex))}
          hint="Wallex depth"
          estimated={false}
        />
        <StatCard
          title="PAXG (USD)"
          value={formatUsd(prices.foreignGold?.["pax-gold"])}
          hint="CoinGecko"
          estimated={false}
        />
        <StatCard
          title="XAUT (USD)"
          value={formatUsd(prices.foreignGold?.["tether-gold"])}
          hint="CoinGecko"
          estimated={false}
        />
        <StatCard
          title="طلای ۱۸ (کیلو / تومان)"
          value={formatToman(prices.market?.gold18PerKg?.sell)}
          hint={prices.estimated?.gold ? "melt-estimate" : "Navasan"}
          estimated={!!prices.estimated?.gold}
        />
        <StatCard
          title="شمش ۲۴ (کیلو / تومان)"
          value={formatToman(prices.market?.shemsh24PerKg?.sell)}
          hint={prices.estimated?.gold ? "melt-estimate" : "Navasan"}
          estimated={!!prices.estimated?.gold}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>تابلوی صرافی‌ها</CardTitle>
          <CardDescription>
            فقط داده‌ی واقعی از بک‌اند — صرافی‌هایی که API ندارند «بدون داده» هستند.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 text-right font-medium">صرافی</th>
                <th className="py-2 text-left font-medium">وضعیت</th>
                <th className="py-2 text-left font-medium">تتر خرید/فروش</th>
                <th className="py-2 text-left font-medium">دلار خرید/فروش</th>
                <th className="py-2 text-left font-medium">درهم</th>
                <th className="py-2 text-left font-medium">طلای ۱۸ (کیلو)</th>
              </tr>
            </thead>
            <tbody>
              {[...liveIds, ...emptyIds].map((ex) => {
                const row: ExchangeRow = exchanges[ex.id] || {};
                const has =
                  row.usdt || row.usd || row.aed || row.gold18PerKg || row.shemsh24PerKg;
                const estHome =
                  ex.id === "navasan" &&
                  (!!prices.estimated?.usd || !!prices.estimated?.gold) &&
                  !!has;
                return (
                  <tr key={ex.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="py-3 text-right font-semibold">{ex.fa}</td>
                    <td className="py-3 text-left">
                      {has ? (
                        <Badge variant={estHome ? "est" : "live"}>
                          {estHome ? "تخمینی" : "زنده"}
                        </Badge>
                      ) : (
                        <Badge variant="muted">بدون داده</Badge>
                      )}
                    </td>
                    <td className="py-3 text-left">
                      <BuySell pair={row.usdt} />
                    </td>
                    <td className="py-3 text-left">
                      <BuySell pair={row.usd} />
                    </td>
                    <td className="py-3 text-left">
                      <BuySell pair={row.aed} />
                    </td>
                    <td className="py-3 text-left">
                      <BuySell pair={row.gold18PerKg} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function SourcesPanel({
  report,
  health,
}: {
  report: { source: string; label: string; ok: boolean; ms?: number | null; error?: string | null }[];
  health: ReturnType<typeof usePrices>["health"];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Navasan key</CardDescription>
            <CardTitle className="text-lg">
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
            <CardDescription>Outbound proxy</CardDescription>
            <CardTitle className="text-lg">
              {health?.proxy ? <Badge variant="live">on</Badge> : <Badge variant="muted">off</Badge>}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Refresh interval</CardDescription>
            <CardTitle className="font-mono-nums text-lg">
              {health?.refreshSec ?? "—"}s
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>وضعیت منابع (live)</CardTitle>
          <CardDescription>از <code className="text-primary">/api/debug</code></CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {report.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز گزارشی نیست.</p>
          ) : (
            report.map((r) => (
              <div
                key={r.source}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2"
              >
                <div className="text-right">
                  <div className="font-semibold">{r.label}</div>
                  {!r.ok && r.error ? (
                    <div className="max-w-xl truncate text-xs text-red-400" title={r.error}>
                      {r.error}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {r.ms != null ? (
                    <span className="font-mono-nums text-xs text-muted-foreground">{r.ms}ms</span>
                  ) : null}
                  <Badge variant={r.ok ? "live" : "danger"}>{r.ok ? "OK" : "ERR"}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FormulasPanel({ prices }: { prices: PriceModel }) {
  const aedPeg = 3.6725;
  const usd = prices.market?.usd?.sell ?? prices.market?.usd?.buy ?? null;
  const aed = prices.market?.aed?.sell ?? prices.market?.aed?.buy ?? null;
  const fairAed = usd != null ? Math.round(usd / aedPeg) : null;
  const fairUsd = aed != null ? Math.round(aed * aedPeg) : null;
  const g18kg = prices.market?.gold18PerKg?.sell ?? null;
  const g18g = g18kg != null ? Math.round(g18kg / 1000) : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>قیمت واقعی درهم</CardTitle>
          <CardDescription>دلار ÷ {aedPeg}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="font-mono-nums text-sm text-muted-foreground">
            ورودی دلار: {formatToman(usd)} تومان
          </div>
          <div className="font-mono-nums text-2xl font-bold text-primary">
            {formatToman(fairAed)} تومان
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>قیمت واقعی دلار</CardTitle>
          <CardDescription>درهم × {aedPeg}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="font-mono-nums text-sm text-muted-foreground">
            ورودی درهم: {formatToman(aed)} تومان
          </div>
          <div className="font-mono-nums text-2xl font-bold text-primary">
            {formatToman(fairUsd)} تومان
          </div>
          {aed == null ? (
            <p className="text-xs text-amber-400">
              درهم زنده نیست (Navasan key لازم است). فعلاً فقط دلار از USDT/proxy موجود است.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>طلای ۱۸ (گرم)</CardTitle>
          <CardDescription>از کیلو ÷ ۱۰۰۰ — منبع market</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="font-mono-nums text-2xl font-bold">{formatToman(g18g)} تومان/گرم</div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  const { prices, health, report, error, loading, updatedAt, refresh } = usePrices();
  const [busy, setBusy] = useState(false);

  const status = useMemo(() => {
    if (loading && !prices) return "loading";
    if (error && !prices) return "error";
    if (prices?.stale) return "stale";
    if (prices) return "live";
    return "empty";
  }, [loading, error, prices]);

  const onRefresh = async () => {
    setBusy(true);
    await refresh();
    setBusy(false);
  };

  return (
    <div dir="rtl" lang="fa" className="min-h-screen">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap"
      />

      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-lg font-extrabold text-primary">
              ﷼
            </div>
            <div>
              <div className="text-base font-extrabold">تابلوی بازار طلا</div>
              <div className="font-mono-nums text-xs text-muted-foreground">
                v{prices?.version || health?.version || "—"}
                {prices?.gitSha || health?.gitSha
                  ? ` · ${String(prices?.gitSha || health?.gitSha).slice(0, 7)}`
                  : ""}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status === "live" ? <Badge variant="live">● زنده</Badge> : null}
            {status === "stale" ? <Badge variant="est">● آخرین معتبر</Badge> : null}
            {status === "error" ? <Badge variant="danger">● خطا</Badge> : null}
            {status === "loading" ? <Badge variant="muted">● بارگذاری</Badge> : null}
            <span className="text-xs text-muted-foreground">
              بروزرسانی: {timeAgo(updatedAt)}
            </span>
            <Button size="sm" onClick={() => void onRefresh()} disabled={busy}>
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              بروزرسانی
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
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

        {prices ? (
          <Tabs defaultValue="market">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="market" className="gap-1.5">
                <LayoutDashboard className="size-4" />
                مانیتورینگ
              </TabsTrigger>
              <TabsTrigger value="sources" className="gap-1.5">
                <Radio className="size-4" />
                منابع API
              </TabsTrigger>
              <TabsTrigger value="formulas" className="gap-1.5">
                <Sigma className="size-4" />
                فرمول‌ها
              </TabsTrigger>
            </TabsList>

            <TabsContent value="market">
              <MarketBoard prices={prices} />
            </TabsContent>
            <TabsContent value="sources">
              <SourcesPanel report={report} health={health} />
            </TabsContent>
            <TabsContent value="formulas">
              <FormulasPanel prices={prices} />
            </TabsContent>
          </Tabs>
        ) : null}

        <Separator />
        <footer className="flex flex-wrap items-center justify-between gap-2 pb-8 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Activity className="size-3.5" />
            UI: shadcn/ui · data: FastAPI <code className="text-primary">/api/prices</code>
          </span>
          <span className="inline-flex items-center gap-1">
            <Coins className="size-3.5" />
            Nobitex · Wallex · gold-api · CoinGecko · Navasan
          </span>
        </footer>
      </main>
    </div>
  );
}

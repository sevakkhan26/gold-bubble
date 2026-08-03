import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchTradeConnectors,
  fetchTradeOrders,
  placeArbitrage,
  previewOrder,
  type OrderRequest,
  type TradeConnector,
  type TradeOrder,
} from "@/lib/api";
import { cn, formatToman } from "@/lib/utils";

/** One place a price can be had: a venue, or a computed reference like the global ounce. */
export type ArbSide = {
  key: string;
  label: string;
  /** Bid — what you receive selling here. */
  buy: number | null;
  /** Ask — what you pay buying here. */
  sell: number | null;
  note?: string;
};

export type ArbitrageSectionProps = {
  title: string;
  subtitle: string;
  /** Unit the prices are quoted per ("گرم", "تتر", "دلار"). */
  unit: string;
  sides: ArbSide[];
  /** Wallet-row ids whose trade connectors can execute this page's legs. */
  assets: string[];
  exchangeNames: Record<string, string>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground";

function cheapestAsk(sides: ArbSide[]) {
  const withAsk = sides.filter((s) => s.sell != null);
  if (!withAsk.length) return null;
  return withAsk.reduce((a, b) => ((b.sell as number) < (a.sell as number) ? b : a));
}

function dearestBid(sides: ArbSide[]) {
  const withBid = sides.filter((s) => s.buy != null);
  if (!withBid.length) return null;
  return withBid.reduce((a, b) => ((b.buy as number) > (a.buy as number) ? b : a));
}

/**
 * One page, one question: where is it cheapest, where is it dearest, and is the
 * gap worth trading? The verdict is derived from live quotes; the desk decides.
 */
export function ArbitrageSection({
  title,
  subtitle,
  unit,
  sides,
  assets,
  exchangeNames,
}: ArbitrageSectionProps) {
  const [connectors, setConnectors] = useState<TradeConnector[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [buyId, setBuyId] = useState<number | null>(null);
  const [sellId, setSellId] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [preview, setPreview] = useState<{ buy: OrderRequest; sell: OrderRequest } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        fetchTradeConnectors(),
        fetchTradeOrders({ asset: assets[0], limit: 5 }).catch(() => ({ count: 0, orders: [] })),
      ]);
      const mine = c.connectors.filter((x) => assets.includes(x.asset));
      setConnectors(mine);
      setOrders(o.orders);
      setBuyId((cur) => (cur && mine.some((m) => m.id === cur) ? cur : mine[0]?.id ?? null));
      setSellId((cur) =>
        cur && mine.some((m) => m.id === cur) ? cur : mine[1]?.id ?? mine[0]?.id ?? null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در خواندن اتصال‌های معامله");
    }
  }, [assets]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPreview(null);
    setResult(null);
  }, [buyId, sellId, qty]);

  const buyAt = cheapestAsk(sides);
  const sellAt = dearestBid(sides);
  const spread =
    buyAt?.sell != null && sellAt?.buy != null ? sellAt.buy - buyAt.sell : null;
  const spreadPct = spread != null && buyAt?.sell ? (spread / buyAt.sell) * 100 : null;
  const worthIt = spreadPct != null && spreadPct > 0;
  const sameSide = buyAt && sellAt && buyAt.key === sellAt.key;

  const qtyNum = Number(qty) || 0;
  const gross = spread != null && qtyNum > 0 ? spread * qtyNum : null;

  const buyConn = connectors.find((c) => c.id === buyId) || null;
  const sellConn = connectors.find((c) => c.id === sellId) || null;
  const ready = Boolean(buyConn && sellConn && buyConn.id !== sellConn.id && qtyNum > 0 && !busy);
  const anyArmed = Boolean((buyConn && !buyConn.dryRun) || (sellConn && !sellConn.dryRun));

  const venue = (c: TradeConnector) =>
    `${exchangeNames[c.exchange] || c.exchange} — ${c.label}`;

  const doPreview = async () => {
    if (!buyConn || !sellConn) return;
    setBusy(true);
    setError(null);
    try {
      const [b, s] = await Promise.all([
        previewOrder({
          connectorId: buyConn.id,
          side: "buy",
          qty: qtyNum,
          price: buyAt?.sell ?? null,
        }),
        previewOrder({
          connectorId: sellConn.id,
          side: "sell",
          qty: qtyNum,
          price: sellAt?.buy ?? null,
        }),
      ]);
      setPreview({ buy: b.request, sell: s.request });
    } catch (e) {
      setError(e instanceof Error ? e.message : "ساخت پیش‌نمایش ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const doExecute = async () => {
    if (!buyConn || !sellConn) return;
    setBusy(true);
    setError(null);
    try {
      const out = await placeArbitrage({
        buyConnectorId: buyConn.id,
        sellConnectorId: sellConn.id,
        qty: qtyNum,
        buyPrice: buyAt?.sell ?? null,
        sellPrice: sellAt?.buy ?? null,
      });
      const line = (label: string, leg: typeof out.buy) =>
        !leg
          ? `${label}: ارسال نشد`
          : leg.status === "dry"
            ? `${label}: آزمایشی`
            : leg.status === "sent"
              ? `${label}: ارسال شد`
              : `${label}: ناموفق — ${leg.error ?? ""}`;
      setResult(
        [out.message, line("خرید", out.buy), line("فروش", out.sell)].filter(Boolean).join(" · ")
      );
      setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "اجرای معامله ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ---- the verdict, first thing on every page ---- */}
      <Card className="stat-card border-border/80 shadow-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <CardHeader className="pb-2">
                <CardDescription>ارزان‌ترین برای خرید</CardDescription>
                <CardTitle className="t-num-lg font-bold text-buy">
                  {formatToman(buyAt?.sell ?? null)}
                </CardTitle>
                <CardDescription>{buyAt?.label ?? "—"}</CardDescription>
              </CardHeader>
            </div>
            <div className="stat-card">
              <CardHeader className="pb-2">
                <CardDescription>گران‌ترین برای فروش</CardDescription>
                <CardTitle className="t-num-lg font-bold text-sell">
                  {formatToman(sellAt?.buy ?? null)}
                </CardTitle>
                <CardDescription>{sellAt?.label ?? "—"}</CardDescription>
              </CardHeader>
            </div>
            <div className="stat-card">
              <CardHeader className="pb-2">
                <CardDescription>اختلاف</CardDescription>
                <CardTitle
                  className={cn(
                    "t-num-lg font-bold",
                    spreadPct == null
                      ? "text-muted-foreground"
                      : worthIt
                        ? "text-buy"
                        : "text-sell"
                  )}
                >
                  {spreadPct != null
                    ? `${spreadPct >= 0 ? "+" : ""}${spreadPct.toFixed(2)}%`
                    : "—"}
                </CardTitle>
                <CardDescription className="t-num">
                  {spread != null ? `${formatToman(spread)} تومان در هر ${unit}` : "داده‌ای نیست"}
                </CardDescription>
              </CardHeader>
            </div>
          </div>

          {spreadPct == null ? (
            <p className="t-md text-muted-foreground">نرخ زنده کافی برای این مقایسه نیست.</p>
          ) : sameSide ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 t-md text-muted-foreground">
              بهترین خرید و فروش هر دو در «{buyAt?.label}» است — فرصتی بین دو طرف نیست.
            </div>
          ) : (
            <div
              className={cn(
                "rounded-lg border p-3 t-md",
                worthIt
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/40"
              )}
            >
              <div className={cn("font-bold", worthIt ? "text-primary" : "text-muted-foreground")}>
                {worthIt
                  ? `بخر از «${buyAt?.label}» و بفروش به «${sellAt?.label}»`
                  : "اختلاف منفی است — الان فرصتی نیست"}
              </div>
              <div className="mt-1 text-muted-foreground">
                هر {unit} {formatToman(buyAt?.sell ?? null)} بخر ·{" "}
                {formatToman(sellAt?.buy ?? null)} بفروش
              </div>
            </div>
          )}

          {spreadPct != null && worthIt && spreadPct < 0.5 ? (
            <p className="flex items-center gap-1 t-md text-warn">
              <AlertTriangle className="size-4" />
              کمتر از ۰.۵٪ — کارمزد دو طرف احتمالاً آن را می‌خورد.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ---- where the numbers came from ---- */}
      <Card>
        <CardHeader>
          <CardTitle>نرخ‌ها</CardTitle>
          <CardDescription>خرید = قیمتی که به شما می‌دهند · فروش = قیمتی که می‌گیرند</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 text-right">منبع</th>
                <th className="py-2 text-left text-buy">خرید</th>
                <th className="py-2 text-left text-sell">فروش</th>
                <th className="py-2 text-left">اسپرد</th>
              </tr>
            </thead>
            <tbody>
              {sides.map((s) => {
                const own = s.buy != null && s.sell != null ? s.sell - s.buy : null;
                return (
                  <tr key={s.key} className="border-b border-border/50">
                    <td className="py-2 text-right font-semibold">
                      {s.label}
                      {s.note ? (
                        <span className="mr-2 t-sm font-normal text-muted-foreground">
                          {s.note}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "t-num py-2 text-left text-buy",
                        sellAt?.key === s.key && "font-bold"
                      )}
                    >
                      {formatToman(s.buy)}
                      {sellAt?.key === s.key ? <span className="mr-1 t-sm">★</span> : null}
                    </td>
                    <td
                      className={cn(
                        "t-num py-2 text-left text-sell",
                        buyAt?.key === s.key && "font-bold"
                      )}
                    >
                      {formatToman(s.sell)}
                      {buyAt?.key === s.key ? <span className="mr-1 t-sm">★</span> : null}
                    </td>
                    <td className="t-num py-2 text-left text-muted-foreground">
                      {own != null ? formatToman(own) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ---- execute both legs ---- */}
      <Card className="stat-card border-border/80">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>اجرای معامله</CardTitle>
              <CardDescription>
                خرید و فروش با یک دکمه — اگر خرید ناموفق باشد، فروش ارسال نمی‌شود.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              بروزرسانی
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="t-md text-sell">{error}</p> : null}

          {connectors.length < 2 ? (
            <p className="t-md text-warn">
              برای اجرا حداقل دو اتصال معامله لازم است (یکی برای خرید، یکی برای فروش) — از صفحه
              «منابع API» اضافه کنید. اتصال‌های موجود برای این صفحه: {connectors.length}
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block t-md">
                  <span className="text-muted-foreground">خرید از</span>
                  <select
                    className={inputClass}
                    value={buyId ?? ""}
                    onChange={(e) => setBuyId(Number(e.target.value))}
                  >
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {venue(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block t-md">
                  <span className="text-muted-foreground">فروش به</span>
                  <select
                    className={inputClass}
                    value={sellId ?? ""}
                    onChange={(e) => setSellId(Number(e.target.value))}
                  >
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {venue(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block t-md">
                  <span className="text-muted-foreground">مقدار ({unit})</span>
                  <input
                    className={cn(inputClass, "t-num")}
                    dir="ltr"
                    inputMode="decimal"
                    value={qty}
                    placeholder="0"
                    onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 t-md">
                <span className="text-muted-foreground">سود ناخالص (بدون کارمزد)</span>
                <span className="t-num font-bold text-primary">
                  {gross != null ? `${formatToman(gross)} تومان` : "—"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {anyArmed ? (
                  <Badge variant="danger">فعال — سفارش واقعی ارسال می‌شود</Badge>
                ) : (
                  <Badge variant="muted">آزمایشی — چیزی ارسال نمی‌شود</Badge>
                )}
                {buyConn && sellConn && buyConn.id === sellConn.id ? (
                  <span className="t-sm text-warn">خرید و فروش نباید یک اتصال باشند.</span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={() => void doPreview()} disabled={!ready}>
                  پیش‌نمایش
                </Button>
                <Button onClick={() => void doExecute()} disabled={!ready}>
                  <ArrowLeftRight className="size-3.5" />
                  اجرای معامله
                </Button>
              </div>

              {preview ? (
                <pre
                  className="t-num max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-3 t-sm"
                  dir="ltr"
                >
                  {`BUY  ${preview.buy.method} ${preview.buy.url}\n${preview.buy.body || "(no body)"}\n\nSELL ${preview.sell.method} ${preview.sell.url}\n${preview.sell.body || "(no body)"}`}
                </pre>
              ) : null}

              {result ? <p className="t-md">{result}</p> : null}
            </>
          )}

          {orders.length ? (
            <div className="space-y-1 border-t border-border pt-3">
              <div className="t-md font-semibold">آخرین سفارش‌ها</div>
              {orders.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 t-sm">
                  <Badge
                    variant={
                      o.status === "sent" ? "live" : o.status === "dry" ? "muted" : "danger"
                    }
                  >
                    {o.status === "sent" ? "ارسال" : o.status === "dry" ? "آزمایشی" : "ناموفق"}
                  </Badge>
                  <span className={o.side === "buy" ? "text-buy" : "text-sell"}>
                    {o.side === "buy" ? "خرید" : "فروش"}
                  </span>
                  <span className="t-num">
                    {o.qty} {unit}
                  </span>
                  <span className="text-muted-foreground">
                    {exchangeNames[o.exchange] || o.exchange}
                  </span>
                  <span className="t-num text-muted-foreground">
                    {o.total != null ? `${formatToman(o.total)} تومان` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

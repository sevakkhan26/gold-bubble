import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchTradeConnectors,
  fetchTradeOrders,
  placeOrder,
  previewOrder,
  type OrderRequest,
  type TradeConnector,
  type TradeOrder,
} from "@/lib/api";
import { cn, formatToman } from "@/lib/utils";

type Side = "buy" | "sell";

export type TradePanelProps = {
  /** Wallet row this panel trades, e.g. gold18dom. */
  asset: string;
  /** Human label for the unit ("گرم"). */
  unit: string;
  /** Exchange id → live buy/sell price for this asset, per unit. */
  quotes: Record<string, { buy: number | null; sell: number | null }>;
  /** Exchange id → how much of this asset the user holds there. */
  holdings: Record<string, number>;
  exchangeNames: Record<string, string>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground";

/** Buy/sell ticket wired to the user's own exchange order endpoints. */
export function TradePanel({ asset, unit, quotes, holdings, exchangeNames }: TradePanelProps) {
  const [connectors, setConnectors] = useState<TradeConnector[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [connectorId, setConnectorId] = useState<number | null>(null);
  const [side, setSide] = useState<Side>("buy");
  const [qty, setQty] = useState("");
  const [priceOverride, setPriceOverride] = useState("");
  const [preview, setPreview] = useState<{ dryRun: boolean; request: OrderRequest } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        fetchTradeConnectors(),
        fetchTradeOrders({ asset, limit: 10 }).catch(() => ({ count: 0, orders: [] })),
      ]);
      const mine = c.connectors.filter((x) => x.asset === asset);
      setConnectors(mine);
      setOrders(o.orders);
      setConnectorId((cur) => (cur && mine.some((m) => m.id === cur) ? cur : mine[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در خواندن اتصال‌های معامله");
    }
  }, [asset]);

  useEffect(() => {
    void load();
  }, [load]);

  const connector = connectors.find((c) => c.id === connectorId) || null;
  const quote = connector ? quotes[connector.exchange] : undefined;
  const held = connector ? holdings[connector.exchange] ?? null : null;

  // Buying costs the ask, selling earns the bid.
  const marketPrice = side === "buy" ? quote?.sell ?? null : quote?.buy ?? null;
  const price = priceOverride ? Number(priceOverride) || null : marketPrice;
  const qtyNum = Number(qty) || 0;
  const total = price != null && qtyNum > 0 ? price * qtyNum : null;
  const overSells = side === "sell" && held != null && qtyNum > held;

  const canSubmit = Boolean(connector) && qtyNum > 0 && !busy;

  useEffect(() => {
    setPreview(null);
    setResult(null);
  }, [connectorId, side, qty, priceOverride]);

  const sideLabel = side === "buy" ? "خرید" : "فروش";

  const doPreview = async () => {
    if (!connector) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewOrder({ connectorId: connector.id, side, qty: qtyNum, price }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "ساخت پیش‌نمایش ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async () => {
    if (!connector) return;
    setBusy(true);
    setError(null);
    try {
      const out = await placeOrder({ connectorId: connector.id, side, qty: qtyNum, price });
      setResult(
        out.status === "dry"
          ? "حالت آزمایشی: درخواست ساخته شد ولی به صرافی ارسال نشد."
          : out.status === "sent"
            ? `ارسال شد (HTTP ${out.httpStatus}) — پاسخ صرافی: ${out.response ?? "—"}`
            : `ناموفق: ${out.error ?? "خطای نامشخص"}`
      );
      setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ثبت سفارش ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = useMemo(
    () => (o: TradeOrder) =>
      o.status === "sent" ? (
        <Badge variant="live">ارسال شد</Badge>
      ) : o.status === "dry" ? (
        <Badge variant="muted">آزمایشی</Badge>
      ) : (
        <Badge variant="danger">ناموفق</Badge>
      ),
    []
  );

  return (
    <Card className="stat-card border-border/80 shadow-md">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>معامله</CardTitle>
            <CardDescription>
              صرافی را انتخاب کنید، مقدار را بزنید و خرید یا فروش را ثبت کنید. سفارش از طریق API
              همان صرافی ارسال می‌شود.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            بروزرسانی
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="t-md text-sell">{error}</p> : null}

        {connectors.length === 0 ? (
          <p className="t-md text-muted-foreground">
            هنوز اتصال معامله‌ای برای این دارایی ثبت نشده — از صفحه «منابع API» بخش «اتصال معامله»
            آدرس سفارش‌گذاری صرافی را اضافه کنید.
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block t-md">
                <span className="text-muted-foreground">صرافی</span>
                <select
                  className={inputClass}
                  value={connectorId ?? ""}
                  onChange={(e) => setConnectorId(Number(e.target.value))}
                >
                  {connectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {exchangeNames[c.exchange] || c.exchange} — {c.label}
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

              <label className="block t-md">
                <span className="text-muted-foreground">نرخ هر {unit} (اختیاری)</span>
                <input
                  className={cn(inputClass, "t-num")}
                  dir="ltr"
                  inputMode="decimal"
                  value={priceOverride}
                  placeholder={marketPrice != null ? formatToman(marketPrice) : "نرخ بازار"}
                  onChange={(e) => setPriceOverride(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={side === "buy" ? "default" : "ghost"}
                onClick={() => setSide("buy")}
              >
                <ArrowDownLeft className="size-3.5" />
                خرید
              </Button>
              <Button
                size="sm"
                variant={side === "sell" ? "default" : "ghost"}
                onClick={() => setSide("sell")}
              >
                <ArrowUpRight className="size-3.5" />
                فروش
              </Button>
              {connector?.dryRun ? (
                <Badge variant="muted">حالت آزمایشی — ارسال نمی‌شود</Badge>
              ) : (
                <Badge variant="danger">فعال — سفارش واقعی ارسال می‌شود</Badge>
              )}
            </div>

            <div className="grid gap-2 rounded-lg border border-border p-3 t-md md:grid-cols-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">موجودی شما در این صرافی</span>
                <span className="t-num">
                  {held != null ? `${held} ${unit}` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">نرخ {sideLabel} بازار</span>
                <span className="t-num">{formatToman(marketPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">نرخ استفاده‌شده</span>
                <span className="t-num">{formatToman(price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">مبلغ کل</span>
                <span className={cn("t-num font-bold", side === "buy" ? "text-buy" : "text-sell")}>
                  {formatToman(total)} تومان
                </span>
              </div>
            </div>

            {overSells ? (
              <p className="flex items-center gap-1 t-md text-warn">
                <AlertTriangle className="size-4" />
                مقدار فروش از موجودی شما در این صرافی بیشتر است.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => void doPreview()} disabled={!canSubmit}>
                پیش‌نمایش درخواست
              </Button>
              <Button onClick={() => void doSubmit()} disabled={!canSubmit}>
                ثبت {sideLabel}
                {connector?.dryRun ? " (آزمایشی)" : ""}
              </Button>
            </div>

            {preview ? (
              <pre
                className="t-num max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-3 t-sm"
                dir="ltr"
              >
                {preview.request.method} {preview.request.url}
                {"\n"}
                {preview.request.body || "(بدون بدنه)"}
              </pre>
            ) : null}

            {result ? <p className="t-md">{result}</p> : null}
          </>
        )}

        {orders.length ? (
          <div className="space-y-2">
            <div className="t-md font-semibold">آخرین سفارش‌ها</div>
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 t-md"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(o)}
                  <span className={o.side === "buy" ? "text-buy" : "text-sell"}>
                    {o.side === "buy" ? "خرید" : "فروش"}
                  </span>
                  <span className="t-num">
                    {o.qty} {unit}
                  </span>
                  <span className="text-muted-foreground">
                    {exchangeNames[o.exchange] || o.exchange}
                  </span>
                </div>
                <div className="t-num text-muted-foreground">
                  {o.total != null ? `${formatToman(o.total)} تومان` : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

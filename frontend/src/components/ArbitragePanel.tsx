import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchTradeConnectors,
  placeArbitrage,
  previewOrder,
  type OrderRequest,
  type TradeConnector,
} from "@/lib/api";
import { cn, formatToman } from "@/lib/utils";

export type ArbitragePanelProps = {
  /** Wallet row traded on the Iranian side, e.g. gold18dom. */
  domesticAsset: string;
  /** Wallet row traded abroad, e.g. gold18for. */
  foreignAsset: string;
  unit: string;
  /** Domestic price per unit, toman. */
  domesticPrice: number | null;
  /** Global value per unit converted to toman (ounce × dollar ÷ troy × purity). */
  foreignPrice: number | null;
  exchangeNames: Record<string, string>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground";

/**
 * Gold at home vs the global ounce, and the two orders that close the gap.
 *
 * Domestic dearer → buy abroad, sell at home. Domestic cheaper → the reverse.
 * The direction is derived from the spread, never chosen by hand.
 */
export function ArbitragePanel({
  domesticAsset,
  foreignAsset,
  unit,
  domesticPrice,
  foreignPrice,
  exchangeNames,
}: ArbitragePanelProps) {
  const [connectors, setConnectors] = useState<TradeConnector[]>([]);
  const [domesticId, setDomesticId] = useState<number | null>(null);
  const [foreignId, setForeignId] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [preview, setPreview] = useState<{ buy: OrderRequest; sell: OrderRequest } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { connectors: all } = await fetchTradeConnectors();
      setConnectors(all);
      const dom = all.filter((c) => c.asset === domesticAsset);
      const forn = all.filter((c) => c.asset === foreignAsset);
      setDomesticId((cur) => (cur && dom.some((c) => c.id === cur) ? cur : dom[0]?.id ?? null));
      setForeignId((cur) => (cur && forn.some((c) => c.id === cur) ? cur : forn[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در خواندن اتصال‌های معامله");
    }
  }, [domesticAsset, foreignAsset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPreview(null);
    setResult(null);
  }, [domesticId, foreignId, qty]);

  const domesticOptions = connectors.filter((c) => c.asset === domesticAsset);
  const foreignOptions = connectors.filter((c) => c.asset === foreignAsset);
  const domestic = domesticOptions.find((c) => c.id === domesticId) || null;
  const foreign = foreignOptions.find((c) => c.id === foreignId) || null;

  const diff =
    domesticPrice != null && foreignPrice != null ? domesticPrice - foreignPrice : null;
  const diffPct = diff != null && foreignPrice ? (diff / foreignPrice) * 100 : null;

  // Positive spread: home is dearer, so buy the cheap side (abroad) and sell at home.
  const domesticDearer = diff != null && diff > 0;
  const buyLeg = domesticDearer ? foreign : domestic;
  const sellLeg = domesticDearer ? domestic : foreign;
  const buyPrice = domesticDearer ? foreignPrice : domesticPrice;
  const sellPrice = domesticDearer ? domesticPrice : foreignPrice;

  const qtyNum = Number(qty) || 0;
  const grossProfit = diff != null && qtyNum > 0 ? Math.abs(diff) * qtyNum : null;
  const ready = Boolean(buyLeg && sellLeg && qtyNum > 0 && diff != null && !busy);
  const anyArmed = Boolean((buyLeg && !buyLeg.dryRun) || (sellLeg && !sellLeg.dryRun));

  const doPreview = async () => {
    if (!buyLeg || !sellLeg) return;
    setBusy(true);
    setError(null);
    try {
      const [b, s] = await Promise.all([
        previewOrder({ connectorId: buyLeg.id, side: "buy", qty: qtyNum, price: buyPrice }),
        previewOrder({ connectorId: sellLeg.id, side: "sell", qty: qtyNum, price: sellPrice }),
      ]);
      setPreview({ buy: b.request, sell: s.request });
    } catch (e) {
      setError(e instanceof Error ? e.message : "ساخت پیش‌نمایش ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const doExecute = async () => {
    if (!buyLeg || !sellLeg) return;
    setBusy(true);
    setError(null);
    try {
      const out = await placeArbitrage({
        buyConnectorId: buyLeg.id,
        sellConnectorId: sellLeg.id,
        qty: qtyNum,
        buyPrice,
        sellPrice,
      });
      const line = (label: string, leg: typeof out.buy) =>
        !leg
          ? `${label}: ارسال نشد`
          : leg.status === "dry"
            ? `${label}: آزمایشی (ارسال نشد)`
            : leg.status === "sent"
              ? `${label}: ارسال شد`
              : `${label}: ناموفق — ${leg.error ?? ""}`;
      setResult(
        [out.message, line("خرید", out.buy), line("فروش", out.sell)]
          .filter(Boolean)
          .join(" · ")
      );
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "اجرای آربیتراژ ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const venue = (c: TradeConnector | null) =>
    c ? `${exchangeNames[c.exchange] || c.exchange} — ${c.label}` : "—";

  return (
    <Card className="stat-card border-border/80 shadow-md">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>آربیتراژ داخلی ↔ جهانی</CardTitle>
            <CardDescription>
              اختلاف طلای داخلی با ارزش انس جهانی، و اجرای هر دو سمت معامله با یک دکمه.
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

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="stat-card">
            <CardHeader className="pb-2">
              <CardDescription>طلای داخلی (هر {unit})</CardDescription>
              <CardTitle className="t-num-lg font-bold">{formatToman(domesticPrice)}</CardTitle>
            </CardHeader>
          </div>
          <div className="stat-card">
            <CardHeader className="pb-2">
              <CardDescription>ارزش جهانی (هر {unit})</CardDescription>
              <CardTitle className="t-num-lg font-bold">{formatToman(foreignPrice)}</CardTitle>
            </CardHeader>
          </div>
          <div className="stat-card">
            <CardHeader className="pb-2">
              <CardDescription>اختلاف</CardDescription>
              <CardTitle
                className={cn(
                  "t-num-lg font-bold",
                  diffPct == null
                    ? "text-muted-foreground"
                    : diffPct > 0
                      ? "text-sell"
                      : "text-buy"
                )}
              >
                {diffPct != null
                  ? `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%`
                  : "—"}
              </CardTitle>
              <CardDescription className="t-num">
                {diff != null ? `${formatToman(Math.abs(diff))} تومان در هر ${unit}` : "داده‌ای نیست"}
              </CardDescription>
            </CardHeader>
          </div>
        </div>

        {diff == null ? (
          <p className="t-md text-muted-foreground">
            برای محاسبه اختلاف، نرخ داخلی و انس جهانی هر دو باید زنده باشند.
          </p>
        ) : (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 t-md">
            <div className="font-bold text-primary">
              {domesticDearer
                ? "طلای داخلی گران‌تر است → در بازار جهانی بخر، در بازار داخلی بفروش"
                : "طلای داخلی ارزان‌تر است → در بازار داخلی بخر، در بازار جهانی بفروش"}
            </div>
            <div className="mt-1 text-muted-foreground">
              خرید از {venue(buyLeg)} · فروش به {venue(sellLeg)}
            </div>
          </div>
        )}

        {domesticOptions.length === 0 || foreignOptions.length === 0 ? (
          <p className="t-md text-warn">
            برای اجرا به دو اتصال معامله نیاز است: یکی برای «{domesticAsset}» و یکی برای «
            {foreignAsset}» — از صفحه «منابع API» اضافه کنید.
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block t-md">
                <span className="text-muted-foreground">صرافی داخلی</span>
                <select
                  className={inputClass}
                  value={domesticId ?? ""}
                  onChange={(e) => setDomesticId(Number(e.target.value))}
                >
                  {domesticOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {venue(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block t-md">
                <span className="text-muted-foreground">صرافی خارجی</span>
                <select
                  className={inputClass}
                  value={foreignId ?? ""}
                  onChange={(e) => setForeignId(Number(e.target.value))}
                >
                  {foreignOptions.map((c) => (
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

            <div className="grid gap-2 rounded-lg border border-border p-3 t-md md:grid-cols-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">نرخ خرید</span>
                <span className="t-num text-buy">{formatToman(buyPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">نرخ فروش</span>
                <span className="t-num text-sell">{formatToman(sellPrice)}</span>
              </div>
              <div className="flex justify-between md:col-span-2">
                <span className="text-muted-foreground">سود ناخالص (بدون کارمزد)</span>
                <span className="t-num font-bold text-primary">
                  {grossProfit != null ? `${formatToman(grossProfit)} تومان` : "—"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {anyArmed ? (
                <Badge variant="danger">فعال — سفارش واقعی ارسال می‌شود</Badge>
              ) : (
                <Badge variant="muted">هر دو اتصال آزمایشی‌اند — چیزی ارسال نمی‌شود</Badge>
              )}
              <span className="t-sm text-muted-foreground">
                اگر خرید ناموفق باشد، فروش ارسال نمی‌شود.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => void doPreview()} disabled={!ready}>
                پیش‌نمایش هر دو سفارش
              </Button>
              <Button onClick={() => void doExecute()} disabled={!ready}>
                <ArrowLeftRight className="size-3.5" />
                اجرای آربیتراژ
              </Button>
            </div>

            {grossProfit != null && diffPct != null && Math.abs(diffPct) < 0.5 ? (
              <p className="flex items-center gap-1 t-md text-warn">
                <AlertTriangle className="size-4" />
                اختلاف کمتر از ۰.۵٪ است — احتمالاً کارمزد دو طرف آن را می‌خورد.
              </p>
            ) : null}

            {preview ? (
              <pre
                className="t-num max-h-48 overflow-auto rounded-lg border border-border bg-muted/40 p-3 t-sm"
                dir="ltr"
              >
                {`BUY  ${preview.buy.method} ${preview.buy.url}\n${preview.buy.body || "(no body)"}\n\nSELL ${preview.sell.method} ${preview.sell.url}\n${preview.sell.body || "(no body)"}`}
              </pre>
            ) : null}

            {result ? <p className="t-md">{result}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

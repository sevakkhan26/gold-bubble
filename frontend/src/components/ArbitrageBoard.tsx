import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatToman } from "@/lib/utils";

export type ArbRow = {
  id: string;
  fa: string;
  buy: number | null;
  sell: number | null;
};

/** Highest bid = where you sell best; lowest ask = where you buy cheapest. */
function bestOf(rows: ArbRow[], key: "buy" | "sell", pick: "max" | "min") {
  const withValue = rows.filter((r) => r[key] != null) as (ArbRow & Record<typeof key, number>)[];
  if (!withValue.length) return null;
  const best = withValue.reduce((a, b) =>
    pick === "max" ? (b[key] > a[key] ? b : a) : b[key] < a[key] ? b : a
  );
  const ties = withValue.filter((r) => r[key] === best[key]).length;
  // Every venue quoting the same number means there is no "best" worth marking.
  return {
    value: best[key] as number,
    fa: best.fa,
    ties,
    distinct: ties < withValue.length,
  };
}

function BestCard({
  title,
  note,
  best,
  tone,
}: {
  title: string;
  note: string;
  best: { value: number; fa: string; ties: number; distinct: boolean } | null;
  tone: "buy" | "sell";
}) {
  return (
    <div className="stat-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{title}</CardDescription>
          {best && best.ties > 1 ? (
            <Badge variant="muted">{best.ties} صرافی هم‌قیمت</Badge>
          ) : null}
        </div>
        <CardTitle
          className={cn(
            "t-num-lg font-bold tracking-tight",
            tone === "buy" ? "text-buy" : "text-sell"
          )}
        >
          {best ? formatToman(best.value) : "—"}
        </CardTitle>
        <CardDescription>
          {!best
            ? "داده‌ای نیست"
            : best.distinct
              ? `${best.fa} · ${note}`
              : "همه صرافی‌ها یک نرخ می‌دهند"}
        </CardDescription>
      </CardHeader>
    </div>
  );
}

/** Per-exchange buy/sell board with the best quotes on top. */
export function ArbitrageBoard({
  title,
  description,
  rows,
  avgSell,
  children,
}: {
  title: string;
  description: string;
  rows: ArbRow[];
  avgSell: number | null;
  /** Rendered between the best-quote cards and the table (e.g. the trade panel). */
  children?: React.ReactNode;
}) {
  const bestBid = bestOf(rows, "buy", "max"); // most you can get when selling
  const bestAsk = bestOf(rows, "sell", "min"); // least you pay when buying
  const spread =
    bestBid && bestAsk ? bestBid.value - bestAsk.value : null;
  const spreadPct =
    spread != null && bestAsk ? (spread / bestAsk.value) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <BestCard
          title="بهترین قیمت خرید (بالاترین)"
          note="گران‌ترین جا برای فروش شما"
          best={bestBid}
          tone="buy"
        />
        <BestCard
          title="بهترین قیمت فروش (پایین‌ترین)"
          note="ارزان‌ترین جا برای خرید شما"
          best={bestAsk}
          tone="sell"
        />
        <div className="stat-card">
          <CardHeader className="pb-2">
            <CardDescription>فاصله بهترین خرید و فروش</CardDescription>
            <CardTitle
              className={cn(
                "t-num-lg font-bold tracking-tight",
                spread != null && spread > 0 ? "text-buy" : "text-muted-foreground"
              )}
            >
              {spread != null ? formatToman(spread) : "—"}
            </CardTitle>
            <CardDescription>
              {spreadPct != null
                ? `${spreadPct >= 0 ? "+" : ""}${spreadPct.toFixed(2)}%${
                    spread != null && spread > 0 ? " — فرصت آربیتراژ" : ""
                  }`
                : "داده‌ای نیست"}
            </CardDescription>
          </CardHeader>
        </div>
      </div>

      {children}

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 text-right">صرافی</th>
                <th className="py-2 text-left text-buy">خرید</th>
                <th className="py-2 text-left text-sell">فروش</th>
                <th className="py-2 text-left">اسپرد</th>
                <th className="py-2 text-left">Δ از میانگین</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const spreadRow =
                  r.buy != null && r.sell != null ? r.sell - r.buy : null;
                const pct =
                  r.sell != null && avgSell ? ((r.sell - avgSell) / avgSell) * 100 : null;
                const isBestBid = bestBid?.distinct === true && r.buy === bestBid.value;
                const isBestAsk = bestAsk?.distinct === true && r.sell === bestAsk.value;
                return (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 text-right font-semibold">{r.fa}</td>
                    <td
                      className={cn(
                        "t-num py-2 text-left text-buy",
                        isBestBid && "font-bold"
                      )}
                    >
                      {formatToman(r.buy)}
                      {isBestBid ? <span className="mr-1 t-sm">★</span> : null}
                    </td>
                    <td
                      className={cn(
                        "t-num py-2 text-left text-sell",
                        isBestAsk && "font-bold"
                      )}
                    >
                      {formatToman(r.sell)}
                      {isBestAsk ? <span className="mr-1 t-sm">★</span> : null}
                    </td>
                    <td className="t-num py-2 text-left text-muted-foreground">
                      {spreadRow != null ? formatToman(spreadRow) : "—"}
                    </td>
                    <td
                      className={cn(
                        "t-num py-2 text-left",
                        pct == null
                          ? "text-muted-foreground"
                          : pct > 0.15
                            ? "text-sell"
                            : pct < -0.15
                              ? "text-buy"
                              : "text-muted-foreground"
                      )}
                    >
                      {pct != null ? `${pct.toFixed(2)}%` : "—"}
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

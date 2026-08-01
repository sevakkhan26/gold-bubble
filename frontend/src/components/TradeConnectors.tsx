import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createTradeConnector,
  deleteTradeConnector,
  fetchTradeConnectors,
  updateTradeConnector,
  SECRET_MASK,
  type TradeConnector,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ASSET_LABELS: Record<string, string> = {
  gold18dom: "طلای ۱۸ عیار داخلی (گرم)",
  gold18for: "طلای ۱۸ عیار خارجی (گرم)",
  gold24dom: "طلای ۲۴ عیار داخلی (گرم)",
  gold24for: "طلای ۲۴ عیار خارجی (گرم)",
  usd: "دلار",
  aed: "درهم",
  usdt: "تتر",
  toman: "موجودی تومانی",
};

type FormState = {
  label: string;
  exchange: string;
  asset: string;
  method: string;
  url: string;
  headerName: string;
  headerValue: string;
  bodyTemplate: string;
  buyValue: string;
  sellValue: string;
};

const EMPTY_FORM: FormState = {
  label: "",
  exchange: "nobitex",
  asset: "gold18dom",
  method: "POST",
  url: "",
  headerName: "Authorization",
  headerValue: "",
  bodyTemplate: '{"side":"{{side}}","amount":{{qty}},"price":{{price}}}',
  buyValue: "buy",
  sellValue: "sell",
};

function formFrom(c: TradeConnector): FormState {
  const [headerName = "Authorization", headerValue = ""] = Object.entries(c.headers || {})[0] || [];
  return {
    label: c.label,
    exchange: c.exchange,
    asset: c.asset,
    method: c.method || "POST",
    url: c.url,
    headerName,
    headerValue,
    bodyTemplate: c.bodyTemplate || "",
    buyValue: c.buyValue || "buy",
    sellValue: c.sellValue || "sell",
  };
}

function payloadFrom(form: FormState) {
  const headers: Record<string, string> = {};
  if (form.headerName.trim() && form.headerValue.trim()) {
    headers[form.headerName.trim()] = form.headerValue.trim();
  }
  return {
    label: form.label.trim(),
    exchange: form.exchange.trim(),
    asset: form.asset,
    method: form.method,
    url: form.url.trim(),
    bodyTemplate: form.bodyTemplate,
    buyValue: form.buyValue.trim() || "buy",
    sellValue: form.sellValue.trim() || "sell",
    headers,
  };
}

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block t-md">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block t-sm text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** CRUD for the order endpoints the trade panel posts to. */
export function TradeConnectors({
  exchanges,
  onChanged,
}: {
  exchanges: { id: string; fa: string }[];
  onChanged?: () => void;
}) {
  const [connectors, setConnectors] = useState<TradeConnector[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      setConnectors((await fetchTradeConnectors()).connectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در خواندن اتصال‌های معامله");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = payloadFrom(form);
      if (!payload.label || !payload.url) throw new Error("نام و آدرس API الزامی است");
      if (editingId === "new") await createTradeConnector(payload);
      else if (typeof editingId === "number") await updateTradeConnector(editingId, payload);
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره نشد");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (c: TradeConnector, body: Partial<TradeConnector>) => {
    setBusy(true);
    try {
      await updateTradeConnector(c.id, body as never);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تغییر ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: TradeConnector) => {
    setBusy(true);
    try {
      await deleteTradeConnector(c.id);
      if (editingId === c.id) setEditingId(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "حذف نشد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stat-card border-border/80">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>اتصال معامله (سفارش‌گذاری)</CardTitle>
            <CardDescription>
              آدرس ثبت سفارش هر صرافی. هر اتصال تازه در <b>حالت آزمایشی</b> ساخته می‌شود: درخواست
              ساخته و نمایش داده می‌شود ولی ارسال نمی‌شود. تا وقتی خودتان «فعال‌سازی ارسال» را نزنید
              هیچ سفارش واقعی ثبت نمی‌شود.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingId("new");
            }}
            disabled={busy}
          >
            <Plus className="size-3.5" />
            اتصال جدید
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="t-md text-sell">{error}</p> : null}

        {connectors.length === 0 && editingId === null ? (
          <p className="t-md text-muted-foreground">هنوز اتصال معامله‌ای ثبت نشده.</p>
        ) : null}

        {connectors.map((c) => (
          <div key={c.id} className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.label}</span>
                  <Badge variant="muted">
                    {exchanges.find((e) => e.id === c.exchange)?.fa || c.exchange}
                  </Badge>
                  <Badge variant="muted">{ASSET_LABELS[c.asset] || c.asset}</Badge>
                  {c.dryRun ? (
                    <Badge variant="muted">آزمایشی</Badge>
                  ) : (
                    <Badge variant="danger">ارسال واقعی</Badge>
                  )}
                  {c.enabled ? null : <Badge variant="muted">غیرفعال</Badge>}
                </div>
                <div className="mt-1 truncate t-sm text-muted-foreground" dir="ltr">
                  {c.method} {c.url}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void patch(c, { dryRun: !c.dryRun })}
                  disabled={busy}
                >
                  {c.dryRun ? "فعال‌سازی ارسال" : "برگشت به آزمایشی"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void patch(c, { enabled: !c.enabled })}
                  disabled={busy}
                >
                  {c.enabled ? "غیرفعال" : "فعال"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setForm(formFrom(c));
                    setEditingId(c.id);
                  }}
                  disabled={busy}
                >
                  ویرایش
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(c)}
                  disabled={busy}
                  aria-label="حذف"
                >
                  <Trash2 className="size-3.5 text-sell" />
                </Button>
              </div>
            </div>
            {editingId === c.id ? (
              <ConnectorForm
                form={form}
                set={set}
                exchanges={exchanges}
                onSave={() => void save()}
                onCancel={() => setEditingId(null)}
                busy={busy}
                editing
              />
            ) : null}
          </div>
        ))}

        {editingId === "new" ? (
          <div className="rounded-lg border border-primary/40">
            <ConnectorForm
              form={form}
              set={set}
              exchanges={exchanges}
              onSave={() => void save()}
              onCancel={() => setEditingId(null)}
              busy={busy}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConnectorForm({
  form,
  set,
  exchanges,
  onSave,
  onCancel,
  busy,
  editing,
}: {
  form: FormState;
  set: (patch: Partial<FormState>) => void;
  exchanges: { id: string; fa: string }[];
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  editing?: boolean;
}) {
  return (
    <div className="grid gap-3 border-t border-border p-3 md:grid-cols-2">
      <Field label="نام اتصال">
        <input
          className={inputClass}
          value={form.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="نوبیتکس — سفارش طلا"
        />
      </Field>
      <Field label="صرافی">
        <select
          className={inputClass}
          value={form.exchange}
          onChange={(e) => set({ exchange: e.target.value })}
        >
          {exchanges.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fa}
            </option>
          ))}
        </select>
      </Field>
      <Field label="دارایی">
        <select
          className={inputClass}
          value={form.asset}
          onChange={(e) => set({ asset: e.target.value })}
        >
          {Object.entries(ASSET_LABELS).map(([id, fa]) => (
            <option key={id} value={id}>
              {fa}
            </option>
          ))}
        </select>
      </Field>
      <Field label="متد">
        <select
          className={inputClass}
          value={form.method}
          onChange={(e) => set({ method: e.target.value })}
        >
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="GET">GET</option>
          <option value="DELETE">DELETE</option>
        </select>
      </Field>
      <Field label="آدرس ثبت سفارش" hint="می‌توانید {{side}} و {{qty}} را در آدرس هم بگذارید">
        <input
          className={inputClass}
          dir="ltr"
          value={form.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://api.nobitex.ir/market/orders/add"
        />
      </Field>
      <Field label="نام هدر احراز هویت">
        <input
          className={inputClass}
          dir="ltr"
          value={form.headerName}
          onChange={(e) => set({ headerName: e.target.value })}
        />
      </Field>
      <Field
        label="مقدار هدر (کلید API با دسترسی معامله)"
        hint={
          editing
            ? `برای نگه‌داشتن کلید فعلی، ${SECRET_MASK} را دست نزنید`
            : "روی سرور ذخیره می‌شود و دیگر نمایش داده نمی‌شود"
        }
      >
        <input
          className={inputClass}
          dir="ltr"
          value={form.headerValue}
          onChange={(e) => set({ headerValue: e.target.value })}
          placeholder="Token xxxxxxxx"
        />
      </Field>
      <Field label="مقدار «خرید» در API">
        <input
          className={inputClass}
          dir="ltr"
          value={form.buyValue}
          onChange={(e) => set({ buyValue: e.target.value })}
          placeholder="buy"
        />
      </Field>
      <Field label="مقدار «فروش» در API">
        <input
          className={inputClass}
          dir="ltr"
          value={form.sellValue}
          onChange={(e) => set({ sellValue: e.target.value })}
          placeholder="sell"
        />
      </Field>
      <Field
        label="قالب بدنه درخواست"
        hint="جای‌گذاری: {{side}} {{qty}} {{price}} {{total}}"
      >
        <textarea
          className={cn(inputClass, "t-num h-24")}
          dir="ltr"
          value={form.bodyTemplate}
          onChange={(e) => set({ bodyTemplate: e.target.value })}
        />
      </Field>
      <div className="flex items-center gap-2 md:col-span-2">
        <Button onClick={onSave} disabled={busy}>
          ذخیره
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
      </div>
    </div>
  );
}

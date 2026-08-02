import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createWalletConnection,
  deleteWalletConnection,
  fetchWalletConnections,
  testWalletConnection,
  updateWalletConnection,
  SECRET_MASK,
  type WalletConnection,
} from "@/lib/api";
import { WALLET_PRESETS } from "@/lib/presets";
import { cn } from "@/lib/utils";

/** Wallet rows a connection can feed — labels mirror the کیف پول page. */
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
  asset: string;
  exchange: string;
  method: string;
  url: string;
  headerName: string;
  headerValue: string;
  body: string;
  jsonPath: string;
  multiplier: string;
};

const EMPTY_FORM: FormState = {
  label: "",
  asset: "usdt",
  exchange: "",
  method: "GET",
  url: "",
  headerName: "Authorization",
  headerValue: "",
  body: "",
  jsonPath: "",
  multiplier: "1",
};

function formFrom(conn: WalletConnection): FormState {
  const [headerName = "Authorization", headerValue = ""] =
    Object.entries(conn.headers || {})[0] || [];
  return {
    label: conn.label,
    asset: conn.asset,
    exchange: conn.exchange || "",
    method: conn.method || "GET",
    url: conn.url,
    headerName,
    headerValue,
    body: conn.body || "",
    jsonPath: conn.jsonPath || "",
    multiplier: String(conn.multiplier ?? 1),
  };
}

function payloadFrom(form: FormState) {
  const headers: Record<string, string> = {};
  if (form.headerName.trim() && form.headerValue.trim()) {
    headers[form.headerName.trim()] = form.headerValue.trim();
  }
  return {
    label: form.label.trim(),
    asset: form.asset,
    exchange: form.exchange,
    method: form.method,
    url: form.url.trim(),
    jsonPath: form.jsonPath.trim(),
    body: form.method === "POST" ? form.body : "",
    multiplier: Number(form.multiplier) || 1,
    headers,
  };
}

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

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground";

/** CRUD for the exchange endpoints that auto-fill the wallet. */
export function WalletConnections({
  exchanges = [],
  onChanged,
}: {
  exchanges?: { id: string; fa: string }[];
  onChanged?: () => void;
}) {
  const [connections, setConnections] = useState<WalletConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testing, setTesting] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchWalletConnections();
      setConnections(data.connections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در خواندن اتصال‌ها");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const startNew = () => {
    setForm(EMPTY_FORM);
    setEditingId("new");
    setError(null);
  };

  const startEdit = (conn: WalletConnection) => {
    setForm(formFrom(conn));
    setEditingId(conn.id);
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = payloadFrom(form);
      if (!payload.label || !payload.url) throw new Error("نام و آدرس API الزامی است");
      if (editingId === "new") await createWalletConnection(payload);
      else if (typeof editingId === "number") await updateWalletConnection(editingId, payload);
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره نشد");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (conn: WalletConnection) => {
    setBusy(true);
    try {
      await deleteWalletConnection(conn.id);
      if (editingId === conn.id) setEditingId(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "حذف نشد");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (conn: WalletConnection) => {
    setBusy(true);
    try {
      await updateWalletConnection(conn.id, { enabled: !conn.enabled });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تغییر وضعیت نشد");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (conn: WalletConnection) => {
    setTesting(conn.id);
    try {
      await testWalletConnection(conn.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تست ناموفق بود");
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card className="stat-card border-border/80">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>اتصال کیف پول به صرافی‌ها</CardTitle>
            <CardDescription>
              آدرس API هر صرافی را اینجا ثبت کنید تا موجودی به‌صورت خودکار در کیف پول پر شود. کلیدها
              روی سرور ذخیره می‌شوند و در مرورگر نمایش داده نمی‌شوند.
            </CardDescription>
          </div>
          <Button size="sm" onClick={startNew} disabled={busy}>
            <Plus className="size-3.5" />
            اتصال جدید
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="t-md text-sell">{error}</p> : null}

        {connections.length === 0 && editingId === null ? (
          <p className="t-md text-muted-foreground">
            هنوز اتصالی ثبت نشده — با «اتصال جدید» اولین API را اضافه کنید.
          </p>
        ) : null}

        {connections.map((conn) => (
          <div key={conn.id} className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{conn.label}</span>
                  <Badge variant="muted">{ASSET_LABELS[conn.asset] || conn.asset}</Badge>
                  {conn.enabled ? null : <Badge variant="muted">غیرفعال</Badge>}
                  {conn.lastOk === true ? <Badge variant="live">OK</Badge> : null}
                  {conn.lastOk === false ? <Badge variant="danger">ERR</Badge> : null}
                </div>
                <div className="mt-1 truncate t-sm text-muted-foreground" dir="ltr">
                  {conn.method} {conn.url} → {conn.jsonPath || "(کل پاسخ)"}
                </div>
                {conn.lastOk === false && conn.lastError ? (
                  <div className="mt-1 max-w-xl truncate t-sm text-sell" dir="ltr">
                    {conn.lastError}
                  </div>
                ) : null}
                {conn.lastValue != null ? (
                  <div className="t-num mt-1 t-sm text-muted-foreground">
                    آخرین مقدار: {conn.lastValue}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void runTest(conn)}
                  disabled={testing === conn.id}
                >
                  <RefreshCw className={cn("size-3.5", testing === conn.id && "animate-spin")} />
                  تست
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void toggle(conn)} disabled={busy}>
                  {conn.enabled ? "غیرفعال" : "فعال"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => startEdit(conn)} disabled={busy}>
                  ویرایش
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(conn)}
                  disabled={busy}
                  aria-label="حذف"
                >
                  <Trash2 className="size-3.5 text-sell" />
                </Button>
              </div>
            </div>

            {editingId === conn.id ? (
              <ConnectionForm
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
            <ConnectionForm
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

function ConnectionForm({
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
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <span className="t-sm text-muted-foreground">پرکردن خودکار:</span>
        {WALLET_PRESETS.map((p) => (
          <Button
            key={p.id}
            variant="ghost"
            size="sm"
            onClick={() => set({ ...p.values, headerValue: "" })}
          >
            {p.label}
          </Button>
        ))}
        <span className="t-sm text-muted-foreground">— فقط کلید API را خودتان بزنید</span>
      </div>
      <Field label="نام اتصال">
        <input
          className={inputClass}
          value={form.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="نوبیتکس — تتر"
        />
      </Field>
      <Field label="این مقدار در کدام ردیف کیف پول بنشیند؟">
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
      <Field
        label="صرافی (اختیاری)"
        hint="برای اینکه در صفحه معامله بدانیم این موجودی در کدام صرافی است"
      >
        <select
          className={inputClass}
          value={form.exchange}
          onChange={(e) => set({ exchange: e.target.value })}
        >
          <option value="">— بدون صرافی —</option>
          {exchanges.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fa}
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
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
      </Field>
      <Field label="آدرس API">
        <input
          className={inputClass}
          dir="ltr"
          value={form.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://api.nobitex.ir/users/wallets/list"
        />
      </Field>
      <Field label="نام هدر احراز هویت">
        <input
          className={inputClass}
          dir="ltr"
          value={form.headerName}
          onChange={(e) => set({ headerName: e.target.value })}
          placeholder="Authorization"
        />
      </Field>
      <Field
        label="مقدار هدر (کلید API)"
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
      {form.method === "POST" ? (
        <Field label="بدنه درخواست (JSON)">
          <textarea
            className={cn(inputClass, "t-num h-20")}
            dir="ltr"
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder='{"currency":"usdt"}'
          />
        </Field>
      ) : null}
      <Field
        label="مسیر مقدار در پاسخ JSON"
        hint="مثال: wallets[0].balance یا result.balances.usdt.free — خالی یعنی کل پاسخ عدد است"
      >
        <input
          className={inputClass}
          dir="ltr"
          value={form.jsonPath}
          onChange={(e) => set({ jsonPath: e.target.value })}
          placeholder="wallets[0].balance"
        />
      </Field>
      <Field label="ضریب تبدیل" hint="ریال → تومان = 0.1 · بدون تبدیل = 1">
        <input
          className={cn(inputClass, "t-num")}
          dir="ltr"
          inputMode="decimal"
          value={form.multiplier}
          onChange={(e) => set({ multiplier: e.target.value.replace(/[^0-9.]/g, "") })}
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

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dealsApi, friendlyError, type DealsApi } from '../lib/api';
import { STATUS_LABEL, STATUS_TONE, dealUrl, validateDeal, whatsappShare, type DealListItem } from '../lib/deals';
import { formatKwd, toChargeMinor, formatUsd } from '../../supabase/functions/_shared/logic';
import { navigate } from '../lib/router';

export function Home({ db, userId, api: injected }: { db: SupabaseClient; userId: string; api?: DealsApi }) {
  const api = useMemo(() => injected ?? dealsApi(db), [db, injected]);
  const [form, setForm] = useState({ shop_name: '', title: '', description: '', price: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<DealListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDeals(await api.mine());
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyError(err));
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateDeal(form);
    if (!v.ok) return setError(v.error);
    setError(null);
    setBusy(true);
    try {
      const { id } = await api.create(v.value);
      setCreated({ id, title: v.value.title });
      setCopied(false);
      setForm((f) => ({ ...f, title: '', description: '', price: '' }));
      void load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const link = created ? dealUrl(window.location.origin, created.id) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const selling = (deals ?? []).filter((d) => d.seller_id === userId);
  const buying = (deals ?? []).filter((d) => d.buyer_id === userId && d.seller_id !== userId);
  const preview = validateDeal(form);

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="mb-1 text-lg font-bold text-slate-900">صفقة جديدة</h2>
        <p className="mb-4 text-sm text-slate-600">سوّ رابط وأرسله لزبونك. يدفع، والمبلغ ينحجز لين يستلم.</p>
        <form onSubmit={submit} className="space-y-3" noValidate aria-label="صفقة جديدة">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">اسم متجرك</span>
              <input className="field" maxLength={60} placeholder="مثل عطور الورد" value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">المنتج</span>
              <input className="field" maxLength={80} placeholder="مثل عطر عود 100 مل" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">السعر بالدينار</span>
              <input className="field" inputMode="decimal" dir="ltr" placeholder="25.500" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">تفاصيل (اختياري)</span>
              <input className="field" maxLength={500} placeholder="اللون، المقاس، التوصيل…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
          {preview.ok && (
            <p className="text-xs text-slate-500">
              المشتري يدفع {formatKwd(preview.value.price_fils)} (في وضع التجربة ينحسب {formatUsd(toChargeMinor(preview.value.price_fils))} لأن حساب Stripe التجريبي ما يدعم الدينار).
            </p>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'لحظة…' : 'سوّ رابط الصفقة'}</button>
        </form>

        {created && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3" role="status">
            <p className="font-semibold text-emerald-900">رابط «{created.title}» جاهز:</p>
            <p className="mt-1 break-all text-sm text-emerald-900" dir="ltr">{link}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost text-sm" onClick={() => void copy()}>{copied ? 'انسخ ✓' : 'انسخ الرابط'}</button>
              <a className="btn-ghost text-sm" href={whatsappShare(link, created.title)} target="_blank" rel="noreferrer">أرسله بالواتساب</a>
              <button type="button" className="btn-ghost text-sm" onClick={() => navigate(`/d/${created.id}`)}>افتح الصفقة</button>
            </div>
          </div>
        )}
      </section>

      {loadError && (
        <div role="alert" className="card text-center">
          <p className="text-red-700">{loadError}</p>
          <button type="button" className="btn-ghost mt-3" onClick={() => void load()}>جرب مرة ثانية</button>
        </div>
      )}

      {deals === null && !loadError && <p className="text-center text-slate-500">نحمّل صفقاتك…</p>}
      {deals !== null && (
        <>
          <DealList title="أبيع" empty="ما سويت صفقات للحين." items={selling} />
          <DealList title="أشتري" empty="ما دفعت لأي صفقة للحين. افتح رابط من بائع عشان تدفع." items={buying} />
        </>
      )}
    </div>
  );
}

function DealList({ title, empty, items }: { title: string; empty: string; items: DealListItem[] }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-bold text-slate-900">{title}</h2>
      {items.length === 0 ? (
        <p className="card text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => navigate(`/d/${d.id}`)} className="card flex w-full items-center justify-between gap-3 text-start hover:border-indigo-300">
                <span>
                  <span className="block font-semibold text-slate-900">{d.title}</span>
                  <span className="block text-sm text-slate-500">{d.shop_name} · {formatKwd(d.price_fils)}</span>
                </span>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

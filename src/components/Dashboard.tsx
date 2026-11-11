import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { friendlyError, subscriptionsApi, type SubscriptionsApi } from '../lib/api';
import { byNextRenewal, daysLabel, formatKwd, monthlyFils, monthlyTotal, todayIso, type Subscription, type SubscriptionInput } from '../lib/subscriptions';
import { SubscriptionForm } from './SubscriptionForm';

const SOON_DAYS = 7;

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('ar-KW', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** api قابل للتبديل في الاختبارات فقط؛ في الموقع يجي من Supabase */
export function Dashboard({ db, email, api: injected }: { db: SupabaseClient; email: string; api?: SubscriptionsApi }) {
  const api = useMemo(() => injected ?? subscriptionsApi(db), [db, injected]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setSubs(await api.list());
      setStatus('ready');
    } catch (err) {
      setLoadError(friendlyError(err));
      setStatus('error');
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  };

  // الأخطاء تنرمي بنص عربي عشان النموذج يعرضها في مكانها
  const wrap = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  };

  const add = async (input: SubscriptionInput) => {
    const created = await wrap(() => api.create(input));
    setSubs((s) => [...s, created]);
    flash(`انضاف ${created.name}`);
  };

  const save = async (id: string, input: SubscriptionInput) => {
    const updated = await wrap(() => api.update(id, input));
    setSubs((s) => s.map((x) => (x.id === id ? updated : x)));
    setEditing(null);
    flash('انحفظ التعديل');
  };

  const remove = async (s: Subscription) => {
    if (!window.confirm(`تبي تحذف ${s.name}؟`)) return;
    try {
      await api.remove(s.id);
      setSubs((list) => list.filter((x) => x.id !== s.id));
      flash(`انحذف ${s.name}`);
    } catch (err) {
      flash(friendlyError(err));
    }
  };

  const today = todayIso();
  const rows = byNextRenewal(subs, today);
  const soon = rows.filter((r) => r.days <= SOON_DAYS);
  const total = monthlyTotal(subs);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">اشتراكاتي</h1>
          <p className="text-xs text-slate-500" dir="ltr">{email}</p>
        </div>
        <button type="button" className="btn-ghost text-sm" onClick={() => void db.auth.signOut()}>تسجيل خروج</button>
      </header>

      <section aria-label="الملخص" className="mb-6 grid grid-cols-2 gap-3">
        <div className="card bg-slate-900 text-white">
          <p className="text-sm text-slate-300">تدفع بالشهر</p>
          <p className="mt-1 text-2xl font-bold" data-testid="monthly-total">{formatKwd(total)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-500">بالسنة تقريبًا</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{formatKwd(total * 12)}</p>
          <p className="mt-1 text-xs text-slate-500">{subs.length} اشتراك</p>
        </div>
      </section>

      <section className="card mb-6">
        <h2 className="mb-3 text-lg font-bold text-slate-900">أضف اشتراك</h2>
        <SubscriptionForm onSubmit={add} />
      </section>

      {notice && <p role="status" className="fixed inset-x-4 bottom-4 z-10 mx-auto max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg">{notice}</p>}

      {status === 'loading' && <p className="py-8 text-center text-slate-500">نحمّل اشتراكاتك…</p>}
      {status === 'error' && (
        <div role="alert" className="card text-center">
          <p className="text-red-700">{loadError}</p>
          <button type="button" className="btn-ghost mt-3" onClick={() => void load()}>جرب مرة ثانية</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <section className="mb-6" aria-labelledby="soon-title">
            <h2 id="soon-title" className="mb-3 text-lg font-bold text-slate-900">التجديدات الجاية خلال {SOON_DAYS} أيام</h2>
            {soon.length === 0 ? (
              <p className="card text-sm text-slate-500">ما في تجديد خلال الأسبوع الجاي.</p>
            ) : (
              <ul className="space-y-2">
                {soon.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <span className="font-semibold text-slate-900">{r.name}</span>
                    <span className="text-sm text-amber-800">{daysLabel(r.days)} · {formatKwd(r.price_fils)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="all-title">
            <h2 id="all-title" className="mb-3 text-lg font-bold text-slate-900">كل اشتراكاتك (الأقرب تجديدًا أول)</h2>
            {rows.length === 0 ? (
              <p className="card text-center text-slate-500">ما عندك اشتراكات للحين. أضف أول اشتراك من فوق.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.id} className="card">
                    {editing === r.id ? (
                      <SubscriptionForm initial={r} onSubmit={(input) => save(r.id, input)} onCancel={() => setEditing(null)} />
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-bold text-slate-900">{r.name}</p>
                          <p className="text-sm text-slate-600">
                            {formatKwd(r.price_fils)} {r.cycle === 'yearly' ? `بالسنة (${formatKwd(monthlyFils(r))} بالشهر)` : 'بالشهر'}
                          </p>
                          <p className="text-sm text-slate-500">
                            يتجدد {fmtDate(r.renewal)} · <span className={r.days <= SOON_DAYS ? 'font-semibold text-amber-700' : ''}>{daysLabel(r.days)}</span>
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(r.id)} aria-label={`تعديل ${r.name}`}>تعديل</button>
                          <button type="button" className="btn-danger text-sm" onClick={() => void remove(r)} aria-label={`حذف ${r.name}`}>حذف</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dealsApi, friendlyError, type DealsApi } from '../lib/api';
import { STATUS_LABEL, STATUS_TONE, actionsFor, dealUrl, fmtDateTime, isFinal, statusMessage, steps, whatsappShare, type DealView, type UiAction } from '../lib/deals';
import { formatKwd, formatUsd, toChargeMinor } from '../../supabase/functions/_shared/logic';
import { navigate } from '../lib/router';
import { AuthForm } from './AuthForm';

const POLL_MS = 2_000;
const WATCH_MS = 6_000;
const MAX_WAIT_MS = 60_000;

const LABEL: Record<UiAction, string> = {
  pay: 'ادفع بأمان (المبلغ ينحجز)',
  login_to_pay: 'سجّل دخول عشان تدفع',
  ship: 'تم الشحن',
  release: 'استلمت الطلب ✓ (حوّل المبلغ للبائع)',
  buyer_cancel: 'ألغِ الطلب وفك الحجز',
  seller_refund: 'ألغِ الصفقة ورجّع المبلغ',
  seller_cancel_unpaid: 'ألغِ الصفقة',
};

const CONFIRM: Partial<Record<UiAction, string>> = {
  release: 'متأكد إنك استلمت الطلب وهو سليم؟ بعدها المبلغ ينتقل للبائع وما يرجع.',
  buyer_cancel: 'تبي تلغي الطلب؟ الحجز ينفك وما ينخصم شي.',
  seller_refund: 'تبي تلغي الصفقة؟ الحجز ينفك والمبلغ يرجع للمشتري.',
  seller_cancel_unpaid: 'تبي تلغي الصفقة؟ الرابط ما راح يشتغل بعدها.',
};

export function DealPage({ db, id, paid, loggedIn, api: injected }: { db: SupabaseClient; id: string; paid: boolean; loggedIn: boolean; api?: DealsApi }) {
  const api = useMemo(() => injected ?? dealsApi(db), [db, injected]);
  const [deal, setDeal] = useState<DealView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<UiAction | null>(null);
  const [verifying, setVerifying] = useState(paid);
  const [showLogin, setShowLogin] = useState(false);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(Date.now());

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await api.get(id);
      setDeal(d);
      setLoadError(null);
      return d;
    } catch (err) {
      setLoadError(friendlyError(err));
      return undefined;
    }
  }, [api, id]);

  useEffect(() => { void load(); }, [load, loggedIn]);

  // رجع من صفحة Stripe بزر الرجوع (bfcache): نفك الأزرار
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setBusy(null); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // بعد الرجوع من Stripe: ننتظر تأكيد الـWebhook (فتح الرابط وحده ما يثبت شي)
  useEffect(() => {
    if (verifying && deal && deal.status !== 'awaiting_payment') {
      setVerifying(false);
      window.history.replaceState(null, '', `/d/${id}`);
    }
  }, [verifying, deal, id]);

  // نسأل كل ثانيتين لين يوصل التأكيد أو تخلص الدقيقة، حتى لو فشل سؤال واحد بسبب الإنترنت
  useEffect(() => {
    if (!verifying) return;
    const t = window.setInterval(() => {
      if (Date.now() - startedAt.current > MAX_WAIT_MS) {
        setVerifying(false);
        return;
      }
      void load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [verifying, load]);

  // الطرف الثاني ممكن يغير الحالة: نحدّث كل شوي لين تخلص الصفقة
  useEffect(() => {
    if (!deal || isFinal(deal.status) || verifying) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, WATCH_MS);
    return () => window.clearInterval(t);
  }, [deal, verifying, load]);

  const run = async (action: UiAction) => {
    if (!deal) return;
    if (action === 'login_to_pay') return setShowLogin(true);
    const question = CONFIRM[action];
    if (question && !window.confirm(question)) return;
    setError(null);
    setBusy(action);
    try {
      if (action === 'pay') {
        window.location.assign(await api.startCheckout(deal.id));
        return; // نخلي الزر مشغول لين ننتقل لصفحة الدفع
      }
      if (action === 'ship') await api.markShipped(deal.id);
      if (action === 'release') await api.act(deal.id, 'release');
      if (action === 'buyer_cancel' || action === 'seller_refund') await api.act(deal.id, 'cancel');
      if (action === 'seller_cancel_unpaid') await api.cancelUnpaid(deal.id);
      await load();
    } catch (err) {
      setError(friendlyError(err));
      await load();
    }
    setBusy(null);
  };

  if (deal === undefined && !loadError) return <p className="py-16 text-center text-slate-500">نحمّل الصفقة…</p>;
  if (deal === null || (deal === undefined && loadError)) {
    return (
      <div className="card text-center">
        <h1 className="text-xl font-bold text-slate-900">{deal === null ? 'ما لقينا هالصفقة' : 'تعذر تحميل الصفقة'}</h1>
        <p className="mt-2 text-slate-600">{deal === null ? 'الرابط غلط أو الصفقة انحذفت.' : loadError}</p>
        <div className="mt-4 flex justify-center gap-2">
          {deal === undefined && <button type="button" className="btn-primary" onClick={() => void load()}>جرب مرة ثانية</button>}
          <button type="button" className="btn-ghost" onClick={() => navigate('/')}>الرئيسية</button>
        </div>
      </div>
    );
  }
  if (!deal) return null;

  const actions = actionsFor(deal, loggedIn);
  const link = dealUrl(window.location.origin, deal.id);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">{deal.shop_name}</p>
            <h1 className="text-2xl font-bold text-slate-900">{deal.title}</h1>
            {deal.description && <p className="mt-1 text-slate-600">{deal.description}</p>}
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_TONE[deal.status]}`} data-testid="status">{STATUS_LABEL[deal.status]}</span>
        </div>
        <p className="mt-4 text-3xl font-bold text-slate-900">{formatKwd(deal.price_fils)}</p>
        <p className="text-xs text-slate-500">وضع تجربة: الدفع يتم بـ {formatUsd(toChargeMinor(deal.price_fils))} لأن حساب Stripe التجريبي ما يدعم الدينار.</p>
      </section>

      {verifying ? (
        <div role="status" aria-live="polite" className="card grid place-items-center gap-3 py-10 text-center">
          <span className="size-9 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" aria-hidden="true" />
          <p className="font-bold text-slate-900">جاري التحقق من الدفع…</p>
          <p className="text-sm text-slate-500">ننتظر تأكيد Stripe. لا تحتاج تحدّث الصفحة.</p>
        </div>
      ) : (
        <section className="card" aria-label="حالة الصفقة">
          <ol className="grid gap-2 sm:grid-cols-4">
            {steps(deal.status).map((s) => (
              <li key={s.label} className={`rounded-xl border px-3 py-2 text-sm ${s.state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : s.state === 'current' ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-900' : 'border-slate-200 text-slate-400'}`}>
                {s.state === 'done' ? '✓ ' : ''}{s.label}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-slate-800" data-testid="status-message">{statusMessage(deal)}</p>
          {paid && deal.status === 'awaiting_payment' && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">ما وصلنا تأكيد الدفع للحين. إذا دفعت، الحالة بتتحدث بعد شوي.</p>
          )}
          <ul className="mt-3 space-y-1 text-xs text-slate-500">
            {deal.paid_at && <li>انحجز المبلغ: {fmtDateTime(deal.paid_at)}</li>}
            {deal.shipped_at && <li>انشحن: {fmtDateTime(deal.shipped_at)}</li>}
            {deal.released_at && <li>انتقل المبلغ: {fmtDateTime(deal.released_at)}</li>}
            {deal.cancelled_at && <li>انلغت: {fmtDateTime(deal.cancelled_at)}</li>}
          </ul>
        </section>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!verifying && actions.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(a)}
              className={a === 'pay' || a === 'release' || a === 'ship' || a === 'login_to_pay' ? 'btn-primary flex-1' : 'btn-danger flex-1'}
            >
              {busy === a ? 'لحظة…' : LABEL[a]}
            </button>
          ))}
        </div>
      )}

      {deal.is_seller && deal.status === 'awaiting_payment' && (
        <div className="card flex flex-wrap items-center gap-2">
          <p className="w-full break-all text-sm text-slate-600" dir="ltr">{link}</p>
          <button type="button" className="btn-ghost text-sm" onClick={() => void copy()}>{copied ? 'انسخ ✓' : 'انسخ الرابط'}</button>
          <a className="btn-ghost text-sm" href={whatsappShare(link, deal.title)} target="_blank" rel="noreferrer">أرسله بالواتساب</a>
        </div>
      )}

      {showLogin && !loggedIn && (
        <div className="card">
          <p className="mb-2 text-sm text-slate-600">سجّل دخول أو سوّ حساب، وبعدها ترجع لنفس الصفقة وتدفع.</p>
          <AuthForm db={db} compact />
        </div>
      )}

      <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/')}>صفقاتي</button>
    </div>
  );
}

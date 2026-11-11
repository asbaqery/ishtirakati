import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from '../lib/api';

export function AuthForm({ db }: { db: SupabaseClient }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === 'signup' && password.length < 8) return setError('كلمة المرور لازم تكون 8 أحرف أو أكثر.');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        // رابط التأكيد يرجع لنفس الموقع اللي سجل منه المستخدم
        const { data, error } = await db.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        // Supabase يرجع مستخدم بلا هويات إذا الإيميل مسجل من قبل
        if (data.user && data.user.identities?.length === 0) throw new Error('already registered');
        if (!data.session) setInfo('سوينا حسابك. أكد إيميلك من الرسالة اللي وصلتك، وبعدها سجّل دخول.');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900">اشتراكاتي</h1>
        <p className="mt-2 text-slate-600">اعرف كم تدفع على اشتراكاتك بالشهر، ومتى ينخصم كل واحد.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => { setMode(m); setError(null); setInfo(null); }}
              className={`rounded-lg py-2 ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {m === 'login' ? 'تسجيل دخول' : 'حساب جديد'}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="label">الإيميل</span>
          <input className="field" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">كلمة المرور</span>
          <input
            className="field"
            type="password"
            dir="ltr"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'signup' && <span className="mt-1 block text-xs text-slate-500">8 أحرف أو أكثر</span>}
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {info && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
          {busy ? 'لحظة…' : mode === 'login' ? 'دخول' : 'سوّ حسابي'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-500">ما نطلب بيانات بطاقتك، ولا نربط مع البنك.</p>
    </div>
  );
}

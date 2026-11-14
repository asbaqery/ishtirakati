import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { navigate, useRoute } from './lib/router';
import { AuthForm } from './components/AuthForm';
import { Home } from './components/Home';
import { DealPage } from './components/DealPage';

export default function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // إذا فشل إلغاء الجلسة من السيرفر (انقطاع مثلًا) نمسحها من هالجهاز على الأقل
  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: 'local' });
  };

  if (!supabase) {
    return (
      <Shell>
        <p className="card text-slate-700">
          الموقع ناقصه إعداد: أضف <code dir="ltr">VITE_SUPABASE_URL</code> و<code dir="ltr">VITE_SUPABASE_ANON_KEY</code> في متغيرات البيئة، وبعدها أعد النشر.
        </p>
      </Shell>
    );
  }
  if (!ready) return <p className="py-16 text-center text-slate-500">لحظة…</p>;

  return (
    <Shell
      email={session?.user.email}
      onSignOut={session ? () => void signOut() : undefined}
    >
      {route.name === 'deal' && <DealPage key={`${route.id}:${session?.user.id ?? 'guest'}`} db={supabase} id={route.id} paid={route.paid} loggedIn={!!session} />}
      {route.name === 'home' && (session ? <Home key={session.user.id} db={supabase} userId={session.user.id} /> : <Landing db={supabase} />)}
      {route.name === 'not_found' && (
        <div className="card text-center">
          <h1 className="text-xl font-bold text-slate-900">الصفحة مو موجودة</h1>
          <button type="button" className="btn-ghost mt-4" onClick={() => navigate('/')}>الرئيسية</button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, email, onSignOut }: { children: React.ReactNode; email?: string; onSignOut?: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate('/')} className="text-start">
          <span className="block text-2xl font-bold text-slate-900">ضمان 🛡️</span>
          <span className="block text-xs text-slate-500">ادفع بأمان لحسابات الإنستغرام</span>
        </button>
        {onSignOut && (
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-slate-500 sm:inline" dir="ltr">{email}</span>
            <button type="button" className="btn-ghost text-sm" onClick={onSignOut}>تسجيل خروج</button>
          </div>
        )}
      </header>
      {children}
    </div>
  );
}

function Landing({ db }: { db: NonNullable<typeof supabase> }) {
  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="text-2xl font-bold text-slate-900">لا تحوّل لحساب ما تعرفه. ادفع بضمان.</h1>
        <p className="mt-2 text-slate-600">المبلغ ينحجز على بطاقتك وما ينتقل للبائع إلا لما تستلم طلبك. والبائع يشحن وهو متطمن إن الفلوس موجودة.</p>
        <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          {['البائع يسوي رابط', 'المشتري يدفع والمبلغ ينحجز', 'البائع يشحن', 'المشتري يستلم والمبلغ ينتقل'].map((s, i) => (
            <li key={s} className="rounded-xl border border-slate-200 px-3 py-2"><span className="font-bold text-indigo-600">{i + 1}.</span> {s}</li>
          ))}
        </ol>
      </section>
      <AuthForm db={db} />
    </div>
  );
}

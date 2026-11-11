import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { AuthForm } from './components/AuthForm';
import { Dashboard } from './components/Dashboard';

export default function App() {
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

  if (!supabase) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-900">اشتراكاتي</h1>
        <p className="card mt-6 text-slate-700">
          الموقع ناقصه إعداد: أضف <code dir="ltr">VITE_SUPABASE_URL</code> و<code dir="ltr">VITE_SUPABASE_ANON_KEY</code> في متغيرات البيئة، وبعدها أعد النشر.
        </p>
      </div>
    );
  }
  if (!ready) return <p className="py-16 text-center text-slate-500">لحظة…</p>;
  return session ? <Dashboard key={session.user.id} db={supabase} email={session.user.email ?? ''} /> : <AuthForm db={supabase} />;
}

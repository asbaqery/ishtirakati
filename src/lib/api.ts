import type { SupabaseClient } from '@supabase/supabase-js';
import type { Subscription, SubscriptionInput } from './subscriptions';

const COLUMNS = 'id, name, price_fils, cycle, next_renewal, created_at';

/** user_id يعبّى تلقائيًا من الجلسة في قاعدة البيانات، والمتصفح ما يرسله أبدًا */
export function subscriptionsApi(db: SupabaseClient) {
  return {
    async list(): Promise<Subscription[]> {
      const { data, error } = await db.from('subscriptions').select(COLUMNS).order('next_renewal');
      if (error) throw error;
      return (data ?? []) as Subscription[];
    },
    async create(input: SubscriptionInput): Promise<Subscription> {
      const { data, error } = await db.from('subscriptions').insert(input).select(COLUMNS).single();
      if (error) throw error;
      return data as Subscription;
    },
    async update(id: string, input: SubscriptionInput): Promise<Subscription> {
      const { data, error } = await db.from('subscriptions').update(input).eq('id', id).select(COLUMNS).single();
      if (error) throw error;
      return data as Subscription;
    },
    async remove(id: string): Promise<void> {
      const { error } = await db.from('subscriptions').delete().eq('id', id);
      if (error) throw error;
    },
  };
}

export type SubscriptionsApi = ReturnType<typeof subscriptionsApi>;

/** رسائل عربية واضحة بدل رسائل Supabase الإنجليزية */
export function friendlyError(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (/invalid login credentials/i.test(msg)) return 'الإيميل أو كلمة المرور غلط.';
  if (/already registered|already exists/i.test(msg)) return 'هذا الإيميل مسجل من قبل. سجّل دخول.';
  if (/email not confirmed/i.test(msg)) return 'لازم تأكد إيميلك أول. شيك على بريدك.';
  if (/password should be at least|weak password/i.test(msg)) return 'كلمة المرور ضعيفة. استخدم 8 أحرف أو أكثر.';
  if (/invalid email|unable to validate email/i.test(msg)) return 'الإيميل مو صحيح.';
  if (/rate limit|too many/i.test(msg)) return 'محاولات وايد. انتظر شوي وجرب مرة ثانية.';
  if (/failed to fetch|load failed|network/i.test(msg)) return 'ما قدرنا نوصل للسيرفر. شيك على الإنترنت.';
  if (/jwt|not authenticated|row-level security/i.test(msg)) return 'انتهت جلستك. سجّل دخول مرة ثانية.';
  return 'صار خطأ. جرب مرة ثانية.';
}

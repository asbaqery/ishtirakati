import type { SupabaseClient } from '@supabase/supabase-js';
import type { DealListItem, DealView, DealInput } from './deals';

const LIST_COLUMNS = 'id, shop_name, title, price_fils, status, created_at, seller_id, buyer_id';

export function dealsApi(db: SupabaseClient) {
  return {
    async create(input: DealInput): Promise<{ id: string }> {
      const { data, error } = await db.from('deals').insert(input).select('id').single();
      if (error) throw error;
      return data as { id: string };
    },
    /** RLS ترجع صفقات المستخدم بس (بائع أو مشتري) */
    async mine(): Promise<DealListItem[]> {
      const { data, error } = await db.from('deals').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as DealListItem[];
    },
    async get(id: string): Promise<DealView | null> {
      const { data, error } = await db.rpc('get_deal', { p_id: id });
      if (error) throw error;
      return ((data as DealView[] | null) ?? [])[0] ?? null;
    },
    async markShipped(id: string): Promise<void> {
      const { error } = await db.rpc('mark_shipped', { p_id: id });
      if (error) throw error;
    },
    async cancelUnpaid(id: string): Promise<void> {
      const { error } = await db.rpc('cancel_unpaid_deal', { p_id: id });
      if (error) throw error;
    },
    async startCheckout(id: string): Promise<string> {
      const { data, error } = await db.functions.invoke('create-checkout', { body: { deal_id: id } });
      if (error) throw await functionError(error);
      if (!data?.url) throw new Error('checkout_failed');
      return data.url as string;
    },
    async act(id: string, action: 'release' | 'cancel'): Promise<void> {
      const { error } = await db.functions.invoke('deal-action', { body: { deal_id: id, action } });
      if (error) throw await functionError(error);
    },
  };
}

export type DealsApi = ReturnType<typeof dealsApi>;

/** يطلع كود الخطأ اللي رجعته الـFunction بدل الرسالة العامة */
async function functionError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    const body = await ctx.json().catch(() => null);
    if (body?.error) return new Error(String(body.error));
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** رسائل عربية واضحة */
export function friendlyError(err: unknown): string {
  const msg = `${(err as { name?: string })?.name ?? ''} ${String((err as { message?: string })?.message ?? err ?? '')}`;
  if (/invalid login credentials/i.test(msg)) return 'الإيميل أو كلمة المرور غلط.';
  if (/already registered|already exists/i.test(msg)) return 'هذا الإيميل مسجل من قبل. سجّل دخول.';
  if (/email not confirmed/i.test(msg)) return 'لازم تأكد إيميلك أول. شيك على بريدك.';
  if (/password should be at least|weak password/i.test(msg)) return 'كلمة المرور ضعيفة. استخدم 8 أحرف أو أكثر.';
  if (/invalid email|unable to validate email/i.test(msg)) return 'الإيميل مو صحيح.';
  if (/rate limit|too many/i.test(msg)) return 'محاولات وايد. انتظر شوي وجرب مرة ثانية.';
  if (/own_deal/.test(msg)) return 'هذي صفقتك إنت، ما تقدر تشتريها.';
  if (/reserved/.test(msg)) return 'في مشتري ثاني قاعد يدفع هالصفقة الحين.';
  if (/not_available|bad_state|stripe_conflict|not_allowed/.test(msg)) return 'حالة الصفقة تغيرت. حدّثنا الصفحة.';
  if (/forbidden/.test(msg)) return 'ما تقدر تسوي هالخطوة.';
  if (/not_found/.test(msg)) return 'ما لقينا هالصفقة.';
  if (/not_authenticated|jwt|row-level security/i.test(msg)) return 'انتهت جلستك. سجّل دخول مرة ثانية.';
  if (/failed to fetch|load failed|network|FunctionsFetchError|failed to send a request/i.test(msg)) return 'ما قدرنا نوصل للسيرفر. شيك على الإنترنت.';
  return 'صار خطأ. جرب مرة ثانية.';
}

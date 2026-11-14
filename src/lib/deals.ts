import { parseKwd, type DealStatus } from '../../supabase/functions/_shared/logic';

export interface DealView {
  id: string;
  shop_name: string;
  title: string;
  description: string | null;
  price_fils: number;
  status: DealStatus;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  is_seller: boolean;
  is_buyer: boolean;
  reserved_by_other: boolean;
}

export interface DealListItem {
  id: string;
  shop_name: string;
  title: string;
  price_fils: number;
  status: DealStatus;
  created_at: string;
  seller_id: string;
  buyer_id: string | null;
}

export const STATUS_LABEL: Record<DealStatus, string> = {
  awaiting_payment: 'بانتظار الدفع',
  held: 'المبلغ محجوز',
  shipped: 'انشحن الطلب',
  released: 'انتقل المبلغ للبائع',
  cancelled: 'انلغت الصفقة',
  expired: 'انتهت مدة الحجز',
};

export const STATUS_TONE: Record<DealStatus, string> = {
  awaiting_payment: 'bg-slate-100 text-slate-700',
  held: 'bg-amber-100 text-amber-800',
  shipped: 'bg-sky-100 text-sky-800',
  released: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
};

export const isFinal = (s: DealStatus) => s === 'released' || s === 'cancelled' || s === 'expired';

/** خطوات الصفقة كما يشوفها الطرفين */
export function steps(status: DealStatus): { label: string; state: 'done' | 'current' | 'todo' }[] {
  const order: DealStatus[] = ['awaiting_payment', 'held', 'shipped', 'released'];
  const labels = ['المشتري يدفع', 'المبلغ محجوز', 'البائع يشحن', 'المشتري يستلم والمبلغ ينتقل'];
  if (status === 'cancelled' || status === 'expired') return labels.map((label) => ({ label, state: 'todo' as const }));
  const at = order.indexOf(status);
  return labels.map((label, i) => ({ label, state: i < at || status === 'released' ? 'done' : i === at ? 'current' : 'todo' }));
}

export type UiAction = 'pay' | 'login_to_pay' | 'ship' | 'release' | 'buyer_cancel' | 'seller_refund' | 'seller_cancel_unpaid';

/** الأزرار اللي تطلع لكل طرف (الخادم يتحقق مرة ثانية من كل شي) */
export function actionsFor(d: Pick<DealView, 'status' | 'is_seller' | 'is_buyer' | 'reserved_by_other'>, loggedIn: boolean): UiAction[] {
  if (d.status === 'awaiting_payment') {
    // وقت ما المشتري قاعد يدفع، ما ينفع البائع يلغي ولا مشتري ثاني يدفع
    if (d.reserved_by_other) return [];
    if (d.is_seller) return ['seller_cancel_unpaid'];
    return [loggedIn ? 'pay' : 'login_to_pay'];
  }
  if (d.is_seller) {
    if (d.status === 'held') return ['ship', 'seller_refund'];
    if (d.status === 'shipped') return ['seller_refund'];
    return [];
  }
  if (d.is_buyer) {
    if (d.status === 'held') return ['release', 'buyer_cancel'];
    if (d.status === 'shipped') return ['release'];
  }
  return [];
}

/** رسالة الحالة حسب الطرف */
export function statusMessage(d: Pick<DealView, 'status' | 'is_seller' | 'is_buyer' | 'reserved_by_other'>): string {
  const role = d.is_seller ? 'seller' : d.is_buyer ? 'buyer' : 'visitor';
  switch (d.status) {
    case 'awaiting_payment':
      if (role === 'seller') {
        return d.reserved_by_other
          ? 'في مشتري قاعد يدفع الحين. انتظر شوي والحالة تتحدث بروحها.'
          : 'أرسل الرابط للمشتري. أول ما يدفع، المبلغ ينحجز وتقدر تشحن وإنت مطمّن.';
      }
      if (d.reserved_by_other) return 'في مشتري ثاني قاعد يدفع هالصفقة الحين.';
      return 'ادفع بأمان: المبلغ ينحجز على بطاقتك وما ينتقل للبائع إلا لما تأكد إنك استلمت.';
    case 'held':
      if (role === 'seller') return 'المبلغ محجوز ومضمون. اشحن الطلب وعلّم «تم الشحن».';
      if (role === 'buyer') return 'مبلغك محجوز وما وصل للبائع. تقدر تلغي قبل الشحن ويرجع لك كامل.';
      return 'المبلغ محجوز لهالصفقة.';
    case 'shipped':
      if (role === 'seller') return 'انتظر المشتري يأكد الاستلام عشان ينتقل لك المبلغ.';
      if (role === 'buyer') return 'البائع شحن الطلب. لما يوصلك وتتأكد منه، اضغط «استلمت الطلب».';
      return 'الطلب في الطريق.';
    case 'released':
      return role === 'seller' ? 'المشتري أكد الاستلام وانتقل لك المبلغ ✓' : 'الصفقة خلصت وانتقل المبلغ للبائع ✓';
    case 'cancelled':
      return 'انلغت الصفقة وانفك الحجز، وما انخصم شي من المشتري.';
    case 'expired':
      return 'انتهت مدة الحجز عند البنك وانفك المبلغ. البائع يقدر يسوي صفقة جديدة.';
  }
}

export interface DealForm {
  shop_name: string;
  title: string;
  description: string;
  price: string;
}

export type DealInput = { shop_name: string; title: string; description: string | null; price_fils: number };

export function validateDeal(f: DealForm): { ok: true; value: DealInput } | { ok: false; error: string } {
  const shop_name = f.shop_name.trim().replace(/\s+/g, ' ');
  const title = f.title.trim().replace(/\s+/g, ' ');
  const description = f.description.trim();
  if (!shop_name) return { ok: false, error: 'اكتب اسم متجرك.' };
  if (shop_name.length > 60) return { ok: false, error: 'اسم المتجر أطول من 60 حرف.' };
  if (!title) return { ok: false, error: 'اكتب اسم المنتج.' };
  if (title.length > 80) return { ok: false, error: 'اسم المنتج أطول من 80 حرف.' };
  if (description.length > 500) return { ok: false, error: 'الوصف أطول من 500 حرف.' };
  const price_fils = parseKwd(f.price);
  if (price_fils === null) return { ok: false, error: 'اكتب السعر بالدينار بين 1 و1000، مثل 25.500' };
  return { ok: true, value: { shop_name, title, description: description || null, price_fils } };
}

export const dealUrl = (origin: string, id: string) => `${origin}/d/${id}`;

export const whatsappShare = (url: string, title: string) =>
  `https://wa.me/?text=${encodeURIComponent(`ادفع «${title}» بأمان عن طريق ضمان: المبلغ ينحجز وما يوصلني إلا لما تستلم.\n${url}`)}`;

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-KW-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

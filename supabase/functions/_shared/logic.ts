/** منطق نقي يشترك فيه الموقع والـEdge Functions، وتغطيه الاختبارات. المبالغ بالفلس (1 د.ك = 1000 فلس). */

export type DealStatus = 'awaiting_payment' | 'held' | 'shipped' | 'released' | 'cancelled' | 'expired';
export type DealAction = 'release' | 'cancel';

export const MIN_PRICE_FILS = 1_000;
export const MAX_PRICE_FILS = 1_000_000;
/**
 * حساب Stripe التجريبي ما يدعم KWD، فنحصّل بالدولار بسعر ثابت معلن:
 * 1 د.ك = 3.25 دولار، يعني 1000 فلس = 325 سنت.
 */
export const CHARGE_CURRENCY = 'usd';
export const toChargeMinor = (fils: number) => Math.round((fils * 325) / 1000);
/** حجز الصفقة لمشتري واحد وقت الدفع. جلسة Stripe تنتهي قبله (أقل مدة 30 دقيقة) */
export const RESERVE_MINUTES = 35;
export const CHECKOUT_MINUTES = 31;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** يحول نصًا مثل "12.5" أو "١٢٫٥" إلى فلس. يرجع null لأي قيمة غير صالحة أو خارج الحدود. */
export function parseKwd(raw: string): number | null {
  const t = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  // "1,200" ممكن تكون ألف ومية أو دينار وفلوس، فنرفضها بدل ما نخمّن
  if (/,\d{3}$/.test(t)) return null;
  const s = t.replace(/[٫,]/g, '.');
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const fils = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  return fils >= MIN_PRICE_FILS && fils <= MAX_PRICE_FILS ? fils : null;
}

export const formatKwd = (fils: number) => `${(fils / 1000).toFixed(3)} د.ك`;
export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export interface DealRow {
  id: string;
  seller_id: string;
  buyer_id: string | null;
  price_fils: number;
  status: DealStatus;
  reserved_until: string | null;
  payment_intent_id: string | null;
}

export type CheckoutDecision = { ok: true } | { ok: false; code: 'own_deal' | 'not_available' | 'reserved'; status: number };

/** هل يقدر هالمستخدم يبدأ الدفع؟ */
export function decideCheckout(deal: Pick<DealRow, 'seller_id' | 'buyer_id' | 'status' | 'reserved_until'>, userId: string, now: Date): CheckoutDecision {
  if (deal.seller_id === userId) return { ok: false, code: 'own_deal', status: 403 };
  if (deal.status !== 'awaiting_payment') return { ok: false, code: 'not_available', status: 409 };
  const reservedByOther = deal.buyer_id !== null && deal.buyer_id !== userId && deal.reserved_until !== null && new Date(deal.reserved_until) > now;
  if (reservedByOther) return { ok: false, code: 'reserved', status: 409 };
  return { ok: true };
}

export type ActionDecision = { ok: true } | { ok: false; code: 'forbidden' | 'bad_state'; status: number };

/**
 * release: المشتري يأكد الاستلام فينسحب المبلغ للبائع (من محجوز أو مشحون).
 * cancel: المشتري يلغي قبل الشحن، أو البائع يلغي ويرجّع المبلغ في أي وقت قبل التحويل.
 */
export function decideAction(deal: Pick<DealRow, 'seller_id' | 'buyer_id' | 'status' | 'payment_intent_id'>, userId: string, action: DealAction): ActionDecision {
  const isBuyer = deal.buyer_id === userId;
  const isSeller = deal.seller_id === userId;
  if (!isBuyer && !isSeller) return { ok: false, code: 'forbidden', status: 404 };
  if (!deal.payment_intent_id) return { ok: false, code: 'bad_state', status: 409 };
  if (action === 'release') {
    if (!isBuyer) return { ok: false, code: 'forbidden', status: 403 };
    return deal.status === 'held' || deal.status === 'shipped' ? { ok: true } : { ok: false, code: 'bad_state', status: 409 };
  }
  if (isBuyer && deal.status === 'held') return { ok: true };
  if (isSeller && (deal.status === 'held' || deal.status === 'shipped')) return { ok: true };
  return { ok: false, code: isBuyer && deal.status === 'shipped' ? 'forbidden' : 'bad_state', status: 409 };
}

export interface HoldFacts {
  livemode: boolean;
  metadataDealId: string;
  metadataBuyerId: string;
  paymentIntentId: string;
  paymentIntentStatus: string;
  amount: number;
  currency: string;
}

export type HoldDecision =
  | { action: 'hold' }
  | { action: 'duplicate' }
  | { action: 'ignore'; reason: string }
  /** الدفع وصل لصفقة ما تنتظره: نفك الحجز فورًا عشان ما تنحجز فلوس المشتري بدون سبب */
  | { action: 'void'; reason: string };

/** قرار حدث اكتمال الدفع: كل الفحوص قبل أي كتابة */
export function decideHold(deal: Pick<DealRow, 'id' | 'buyer_id' | 'price_fils' | 'status' | 'payment_intent_id'> | null, f: HoldFacts): HoldDecision {
  if (f.livemode) return { action: 'ignore', reason: 'live-mode event' };
  if (f.paymentIntentStatus !== 'requires_capture') return { action: 'ignore', reason: `payment_intent ${f.paymentIntentStatus}` };
  if (!deal || deal.id !== f.metadataDealId) return { action: 'void', reason: 'deal not found' };
  if (deal.payment_intent_id === f.paymentIntentId) return { action: 'duplicate' };
  if (deal.status !== 'awaiting_payment') return { action: 'void', reason: `deal is ${deal.status}` };
  if (deal.buyer_id !== f.metadataBuyerId) return { action: 'void', reason: 'buyer does not hold the reservation' };
  if (f.currency.toLowerCase() !== CHARGE_CURRENCY || f.amount !== toChargeMinor(deal.price_fils)) return { action: 'void', reason: 'amount mismatch' };
  return { action: 'hold' };
}

/** حالة الصفقة بعد إلغاء الحجز في Stripe: تلقائي (انتهت مدة الحجز) أو بطلب */
export const statusAfterCancel = (cancellationReason: string | null | undefined): DealStatus =>
  cancellationReason === 'automatic' ? 'expired' : 'cancelled';

/** أصل موثوق لروابط العودة من Stripe: SITE_URL بس، أو localhost للتجربة المحلية */
export function allowedOrigin(requestOrigin: string | null, siteUrl: string): string | null {
  const site = siteUrl.replace(/\/+$/, '');
  if (!requestOrigin) return null;
  if (requestOrigin === site) return site;
  try {
    const u = new URL(requestOrigin);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
  } catch {
    return null;
  }
  return null;
}

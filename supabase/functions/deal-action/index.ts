import Stripe from 'npm:stripe@17';
import { adminClient, reply, stripeTestKey, userFromRequest } from '../_shared/http.ts';
import { UUID_RE, decideAction, statusAfterCancel, type DealAction } from '../_shared/logic.ts';

/**
 * release: المشتري يأكد الاستلام فينسحب المبلغ المحجوز للبائع (capture).
 * cancel: نفك الحجز فيرجع المبلغ للمشتري بدون أي خصم (cancel).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply(req, null, 204);
  if (req.method !== 'POST') return reply(req, { error: 'method not allowed' }, 405);

  const db = adminClient();
  const user = await userFromRequest(req, db);
  if (!user) return reply(req, { error: 'not_authenticated' }, 401);

  const body = await req.json().catch(() => null);
  const dealId = typeof body?.deal_id === 'string' ? body.deal_id : '';
  const action = body?.action as DealAction;
  if (!UUID_RE.test(dealId) || (action !== 'release' && action !== 'cancel')) return reply(req, { error: 'bad_request' }, 400);

  const { data: deal, error } = await db
    .from('deals')
    .select('id, seller_id, buyer_id, status, payment_intent_id')
    .eq('id', dealId)
    .maybeSingle();
  if (error) return reply(req, { error: 'database error' }, 500);
  if (!deal) return reply(req, { error: 'not_found' }, 404);

  const decision = decideAction(deal, user.id, action);
  if (!decision.ok) return reply(req, { error: decision.code }, decision.status);

  // إلغاء المشتري مسموح قبل الشحن بس: نحجز الصف أول عشان ما يتسابق مع «تم الشحن» من البائع
  const buyerCancel = action === 'cancel' && deal.buyer_id === user.id;
  if (buyerCancel) {
    const { data: claimed, error: claimError } = await db
      .from('deals')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', deal.id)
      .eq('buyer_id', user.id)
      .eq('status', 'held')
      .select('id')
      .maybeSingle();
    if (claimError) return reply(req, { error: 'database error' }, 500);
    if (!claimed) return reply(req, { error: 'bad_state' }, 409); // البائع شحن قبله
  }

  const stripe = new Stripe(stripeTestKey());
  let pi: Stripe.PaymentIntent;
  try {
    pi = action === 'release'
      ? await stripe.paymentIntents.capture(deal.payment_intent_id!, {}, { idempotencyKey: `release-${deal.id}` })
      : await stripe.paymentIntents.cancel(deal.payment_intent_id!, { cancellation_reason: 'requested_by_customer' }, { idempotencyKey: `cancel-${deal.id}` });
  } catch (err) {
    // مثلًا: طرف ثاني سبقه (انسحب أو انفك الحجز). الـWebhook يحدّث الحالة
    console.error('stripe action failed', action, (err as Error).name);
    if (buyerCancel) {
      await db.from('deals').update({ status: 'held', cancelled_at: null }).eq('id', deal.id).eq('status', 'cancelled');
    }
    return reply(req, { error: 'stripe_conflict' }, 409);
  }
  if (buyerCancel) return reply(req, { status: 'cancelled' });

  const now = new Date().toISOString();
  const patch = action === 'release'
    ? { status: 'released', released_at: now }
    : { status: statusAfterCancel(pi.cancellation_reason), cancelled_at: now };
  const { data: updated, error: updateError } = await db
    .from('deals')
    .update(patch)
    .eq('id', deal.id)
    .in('status', ['held', 'shipped'])
    .select('status')
    .maybeSingle();
  if (updateError) return reply(req, { error: 'database error' }, 500); // الـWebhook يكمّل التحديث
  return reply(req, { status: updated?.status ?? patch.status });
});

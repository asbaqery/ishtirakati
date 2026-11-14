import Stripe from 'npm:stripe@17';
import { adminClient, reply, stripeTestKey, userFromRequest } from '../_shared/http.ts';
import { CHARGE_CURRENCY, CHECKOUT_MINUTES, RESERVE_MINUTES, UUID_RE, allowedOrigin, decideCheckout, toChargeMinor } from '../_shared/logic.ts';

/** يحجز الصفقة للمشتري ويفتح صفحة دفع Stripe بحجز المبلغ بدون سحبه (capture_method: manual). */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply(req, null, 204);
  if (req.method !== 'POST') return reply(req, { error: 'method not allowed' }, 405);

  const origin = allowedOrigin(req.headers.get('origin'), Deno.env.get('SITE_URL') ?? '');
  if (!origin) return reply(req, { error: 'forbidden origin' }, 403);

  const db = adminClient();
  const user = await userFromRequest(req, db);
  if (!user) return reply(req, { error: 'not_authenticated' }, 401);

  const body = await req.json().catch(() => null);
  const dealId = typeof body?.deal_id === 'string' ? body.deal_id : '';
  if (!UUID_RE.test(dealId)) return reply(req, { error: 'bad_request' }, 400);

  const { data: deal, error } = await db
    .from('deals')
    .select('id, seller_id, buyer_id, title, price_fils, status, reserved_until, stripe_session_id')
    .eq('id', dealId)
    .maybeSingle();
  if (error) return reply(req, { error: 'database error' }, 500);
  if (!deal) return reply(req, { error: 'not_found' }, 404);

  const now = new Date();
  const decision = decideCheckout(deal, user.id, now);
  if (!decision.ok) return reply(req, { error: decision.code }, decision.status);

  const stripe = new Stripe(stripeTestKey());

  // نفس المشتري وعنده جلسة دفع مفتوحة: نرجّعه لها بدل ما نمدد الحجز بلا نهاية
  if (deal.buyer_id === user.id && deal.stripe_session_id && deal.reserved_until && new Date(deal.reserved_until) > now) {
    const open = await stripe.checkout.sessions.retrieve(deal.stripe_session_id).catch(() => null);
    if (open?.status === 'open' && open.url) return reply(req, { url: open.url }, 200);
  }

  // الحجز ذري: ينجح لمشتري واحد بس حتى لو ضغط اثنين بنفس اللحظة
  const reservedUntil = new Date(now.getTime() + RESERVE_MINUTES * 60_000).toISOString();
  const { data: reserved, error: reserveError } = await db
    .from('deals')
    .update({ buyer_id: user.id, reserved_until: reservedUntil })
    .eq('id', dealId)
    .eq('status', 'awaiting_payment')
    .or(`buyer_id.is.null,buyer_id.eq.${user.id},reserved_until.lt.${now.toISOString()}`)
    .select('id')
    .maybeSingle();
  if (reserveError) return reply(req, { error: 'database error' }, 500);
  if (!reserved) return reply(req, { error: 'reserved' }, 409);

  const chargeAmount = toChargeMinor(deal.price_fils);
  let session: Stripe.Checkout.Session | null = null;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: Math.floor(now.getTime() / 1000) + CHECKOUT_MINUTES * 60,
      customer_email: user.email ?? undefined,
      client_reference_id: deal.id,
      metadata: { deal_id: deal.id, buyer_id: user.id },
      payment_intent_data: {
        // الحجز: المبلغ يتجمد على البطاقة وما ينسحب إلا لما المشتري يأكد الاستلام
        capture_method: 'manual',
        metadata: { deal_id: deal.id, buyer_id: user.id },
      },
      line_items: [{ quantity: 1, price_data: { currency: CHARGE_CURRENCY, unit_amount: chargeAmount, product_data: { name: deal.title } } }],
      success_url: `${origin}/d/${deal.id}?paid=1`,
      cancel_url: `${origin}/d/${deal.id}`,
    });
    const { data: linked, error: linkError } = await db
      .from('deals')
      .update({ stripe_session_id: session.id, charge_amount: chargeAmount, charge_currency: CHARGE_CURRENCY })
      .eq('id', deal.id)
      .eq('buyer_id', user.id)
      .eq('status', 'awaiting_payment')
      .select('id')
      .maybeSingle();
    if (linkError || !linked) throw new Error('could not link Stripe session');
    if (!session.url) throw new Error('Stripe returned no checkout url');
    return reply(req, { url: session.url }, 201);
  } catch (err) {
    console.error('checkout failed', (err as Error).name, (err as Error).name === 'Error' ? (err as Error).message : '');
    // الجلسة اللي سويناها ما ترتبطت: نسكرها عشان ما أحد يدفع فيها
    if (session) await stripe.checkout.sessions.expire(session.id).catch(() => null);
    // نفك الحجز بس إذا ما في جلسة قديمة مفتوحة لنفس المشتري (حدث انتهائها يفكه لاحقًا)
    await db.from('deals').update({ buyer_id: null, reserved_until: null })
      .eq('id', deal.id).eq('buyer_id', user.id).eq('status', 'awaiting_payment').is('stripe_session_id', null);
    return reply(req, { error: 'checkout_failed' }, 502);
  }
});

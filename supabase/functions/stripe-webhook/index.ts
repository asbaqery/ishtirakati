import Stripe from 'npm:stripe@17';
import { adminClient, stripeTestKey } from '../_shared/http.ts';
import { UUID_RE, decideHold, statusAfterCancel } from '../_shared/logic.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** الحالة الحقيقية للصفقة تجي من هنا بس: حدث موقّع من Stripe، مو فتح رابط النجاح. */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const signature = req.headers.get('stripe-signature');
  if (!secret || !signature) return json({ error: 'missing signature' }, 400);

  const raw = await req.text();
  const stripe = new Stripe(stripeTestKey());
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret, undefined, cryptoProvider);
  } catch {
    return json({ error: 'invalid signature' }, 400);
  }
  if (event.livemode) return json({ ignored: 'live-mode event' });

  const db = adminClient();

  /** نفك الحجز. إذا فشل نرجع 500 عشان Stripe يعيد المحاولة، وما تبقى فلوس المشتري معلقة */
  const voidHold = async (id: string): Promise<boolean> => {
    try {
      await stripe.paymentIntents.cancel(id, { cancellation_reason: 'abandoned' });
      return true;
    } catch (err) {
      // انفك أو انسحب من قبل: ما في شي نسويه
      if ((err as { code?: string }).code === 'payment_intent_unexpected_state') return true;
      console.error('void failed', (err as Error).name);
      return false;
    }
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const dealId = session.metadata?.deal_id ?? '';
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!UUID_RE.test(dealId) || !piId) return json({ error: 'missing deal or payment' }, 400);

    const pi = await stripe.paymentIntents.retrieve(piId);
    const { data: deal, error } = await db
      .from('deals')
      .select('id, buyer_id, price_fils, status, payment_intent_id')
      .eq('id', dealId)
      .maybeSingle();
    if (error) return json({ error: 'database error' }, 500); // Stripe يعيد المحاولة

    const decision = decideHold(deal, {
      livemode: pi.livemode,
      metadataDealId: dealId,
      metadataBuyerId: session.metadata?.buyer_id ?? '',
      paymentIntentId: pi.id,
      paymentIntentStatus: pi.status,
      amount: pi.amount,
      currency: pi.currency,
    });
    if (decision.action === 'ignore') return json({ ignored: decision.reason });
    if (decision.action === 'duplicate') return json({ received: true, duplicate: true });
    if (decision.action === 'void') {
      console.error('voiding hold', decision.reason);
      if (!(await voidHold(pi.id))) return json({ error: 'void failed' }, 500);
      return json({ received: true, voided: decision.reason });
    }

    const { data: held, error: holdError } = await db
      .from('deals')
      .update({ status: 'held', payment_intent_id: pi.id, paid_at: new Date().toISOString(), reserved_until: null, charge_amount: pi.amount, charge_currency: pi.currency })
      .eq('id', dealId)
      .eq('status', 'awaiting_payment')
      .eq('buyer_id', session.metadata?.buyer_id ?? '')
      .select('id')
      .maybeSingle();
    if (holdError) return json({ error: 'database error' }, 500);
    if (!held) {
      // تغيرت الصفقة بين القراءة والكتابة. إذا اللي غيرها نسخة ثانية من نفس الحدث، الحجز صحيح ونخليه
      const { data: current, error: reError } = await db.from('deals').select('payment_intent_id').eq('id', dealId).maybeSingle();
      if (reError) return json({ error: 'database error' }, 500);
      if (current?.payment_intent_id === pi.id) return json({ received: true, duplicate: true });
      if (!(await voidHold(pi.id))) return json({ error: 'void failed' }, 500);
      return json({ received: true, voided: 'deal changed' });
    }
    return json({ received: true });
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const dealId = session.metadata?.deal_id ?? '';
    if (UUID_RE.test(dealId)) {
      const { error } = await db
        .from('deals')
        .update({ buyer_id: null, reserved_until: null, stripe_session_id: null })
        .eq('id', dealId)
        .eq('status', 'awaiting_payment')
        .eq('stripe_session_id', session.id);
      if (error) return json({ error: 'database error' }, 500);
    }
    return json({ received: true });
  }

  if (event.type === 'payment_intent.canceled' || event.type === 'payment_intent.succeeded') {
    // احتياط: لو انفك الحجز أو انسحب المبلغ وما تحدثت الصفقة (انقطاع أو انتهاء مدة الحجز)
    const pi = event.data.object as Stripe.PaymentIntent;
    const now = new Date().toISOString();
    const patch = event.type === 'payment_intent.succeeded'
      ? { status: 'released', released_at: now }
      : { status: statusAfterCancel(pi.cancellation_reason), cancelled_at: now };
    const { error } = await db.from('deals').update(patch).eq('payment_intent_id', pi.id).in('status', ['held', 'shipped']);
    if (error) return json({ error: 'database error' }, 500);
    return json({ received: true });
  }

  return json({ ignored: event.type });
});

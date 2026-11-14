import { describe, expect, it } from 'vitest';
import {
  allowedOrigin, decideAction, decideCheckout, decideHold, formatKwd, parseKwd, statusAfterCancel, toChargeMinor, type HoldFacts,
} from '../supabase/functions/_shared/logic';
import { actionsFor, steps, validateDeal } from '../src/lib/deals';
import { parseRoute } from '../src/lib/router';
import { friendlyError } from '../src/lib/api';

const SELLER = 'seller-1';
const BUYER = 'buyer-1';
const OTHER = 'other-1';
const NOW = new Date('2026-11-14T12:00:00Z');
const DEAL_ID = '11111111-2222-4333-8444-555555555555';

describe('money', () => {
  it.each([['25', 25000], ['25.5', 25500], ['٢٥٫٥٠٠', 25500], ['1', 1000], ['1000', 1000000], ['3,75', 3750]])('parses %s', (raw, fils) => expect(parseKwd(raw)).toBe(fils));
  it.each(['', '0.999', '1000.001', '-5', 'abc', '1,200', '10000', '1.2345'])('rejects %s', (raw) => expect(parseKwd(raw)).toBeNull());
  it('converts to USD cents at 3.25 and formats', () => {
    expect(toChargeMinor(25500)).toBe(8288);
    expect(toChargeMinor(1000)).toBe(325);
    expect(formatKwd(25500)).toBe('25.500 د.ك');
  });
});

describe('decideCheckout', () => {
  const base = { seller_id: SELLER, buyer_id: null as string | null, status: 'awaiting_payment' as const, reserved_until: null as string | null };
  it('lets a new buyer pay', () => expect(decideCheckout(base, BUYER, NOW)).toEqual({ ok: true }));
  it('blocks the seller from buying their own deal', () => expect(decideCheckout(base, SELLER, NOW)).toMatchObject({ ok: false, code: 'own_deal' }));
  it('blocks a paid or cancelled deal', () => {
    expect(decideCheckout({ ...base, status: 'held' as never }, BUYER, NOW)).toMatchObject({ ok: false, code: 'not_available' });
    expect(decideCheckout({ ...base, status: 'cancelled' as never }, BUYER, NOW)).toMatchObject({ ok: false, code: 'not_available' });
  });
  it('blocks a second buyer while the first one is paying, but not after the reservation ends', () => {
    const reserved = { ...base, buyer_id: OTHER, reserved_until: '2026-11-14T12:10:00Z' };
    expect(decideCheckout(reserved, BUYER, NOW)).toMatchObject({ ok: false, code: 'reserved' });
    expect(decideCheckout(reserved, OTHER, NOW)).toEqual({ ok: true });
    expect(decideCheckout({ ...reserved, reserved_until: '2026-11-14T11:59:00Z' }, BUYER, NOW)).toEqual({ ok: true });
  });
});

describe('decideAction', () => {
  const deal = (status: string) => ({ seller_id: SELLER, buyer_id: BUYER, status: status as never, payment_intent_id: 'pi_1' });
  it('only the buyer can release, from held or shipped', () => {
    expect(decideAction(deal('held'), BUYER, 'release')).toEqual({ ok: true });
    expect(decideAction(deal('shipped'), BUYER, 'release')).toEqual({ ok: true });
    expect(decideAction(deal('held'), SELLER, 'release')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(decideAction(deal('released'), BUYER, 'release')).toMatchObject({ ok: false, code: 'bad_state' });
  });
  it('the buyer can cancel only before shipping; the seller can refund until release', () => {
    expect(decideAction(deal('held'), BUYER, 'cancel')).toEqual({ ok: true });
    expect(decideAction(deal('shipped'), BUYER, 'cancel')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(decideAction(deal('held'), SELLER, 'cancel')).toEqual({ ok: true });
    expect(decideAction(deal('shipped'), SELLER, 'cancel')).toEqual({ ok: true });
    expect(decideAction(deal('released'), SELLER, 'cancel')).toMatchObject({ ok: false, code: 'bad_state' });
  });
  it('strangers and unpaid deals are rejected', () => {
    expect(decideAction(deal('held'), OTHER, 'release')).toMatchObject({ ok: false, code: 'forbidden', status: 404 });
    expect(decideAction({ ...deal('held'), payment_intent_id: null }, BUYER, 'release')).toMatchObject({ ok: false, code: 'bad_state' });
  });
});

describe('decideHold (webhook)', () => {
  const deal = { id: DEAL_ID, buyer_id: BUYER, price_fils: 25500, status: 'awaiting_payment' as const, payment_intent_id: null as string | null };
  const facts: HoldFacts = { livemode: false, metadataDealId: DEAL_ID, metadataBuyerId: BUYER, paymentIntentId: 'pi_1', paymentIntentStatus: 'requires_capture', amount: 8288, currency: 'usd' };
  it('holds a matching authorized payment', () => expect(decideHold(deal, facts)).toEqual({ action: 'hold' }));
  it('treats a re-sent event as a duplicate', () => expect(decideHold({ ...deal, status: 'held' as never, payment_intent_id: 'pi_1' }, facts)).toEqual({ action: 'duplicate' }));
  it('ignores live mode and payments that are not authorized holds', () => {
    expect(decideHold(deal, { ...facts, livemode: true }).action).toBe('ignore');
    expect(decideHold(deal, { ...facts, paymentIntentStatus: 'succeeded' }).action).toBe('ignore');
  });
  it('voids the hold when it cannot belong to this deal', () => {
    expect(decideHold(null, facts).action).toBe('void');
    expect(decideHold({ ...deal, status: 'cancelled' as never }, facts).action).toBe('void');
    expect(decideHold({ ...deal, status: 'held' as never, payment_intent_id: 'pi_other' }, facts).action).toBe('void');
    expect(decideHold({ ...deal, buyer_id: OTHER }, facts).action).toBe('void');
    expect(decideHold(deal, { ...facts, amount: 100 }).action).toBe('void');
    expect(decideHold(deal, { ...facts, currency: 'kwd' }).action).toBe('void');
  });
  it('maps Stripe cancellation reasons', () => {
    expect(statusAfterCancel('automatic')).toBe('expired');
    expect(statusAfterCancel('requested_by_customer')).toBe('cancelled');
    expect(statusAfterCancel(null)).toBe('cancelled');
  });
});

describe('allowedOrigin', () => {
  it('accepts the site and localhost only', () => {
    expect(allowedOrigin('https://daman.vercel.app', 'https://daman.vercel.app/')).toBe('https://daman.vercel.app');
    expect(allowedOrigin('http://localhost:5300', 'https://daman.vercel.app')).toBe('http://localhost:5300');
    expect(allowedOrigin('https://evil.example', 'https://daman.vercel.app')).toBeNull();
    expect(allowedOrigin(null, 'https://daman.vercel.app')).toBeNull();
    expect(allowedOrigin('http://daman.vercel.app.evil.example', 'https://daman.vercel.app')).toBeNull();
  });
});

describe('UI rules', () => {
  const view = (status: string, role: 'seller' | 'buyer' | 'visitor', reserved = false) => ({
    status: status as never, is_seller: role === 'seller', is_buyer: role === 'buyer', reserved_by_other: reserved,
  });
  it('shows each party only their own buttons', () => {
    expect(actionsFor(view('awaiting_payment', 'visitor'), false)).toEqual(['login_to_pay']);
    expect(actionsFor(view('awaiting_payment', 'visitor'), true)).toEqual(['pay']);
    expect(actionsFor(view('awaiting_payment', 'visitor', true), true)).toEqual([]);
    expect(actionsFor(view('awaiting_payment', 'seller'), true)).toEqual(['seller_cancel_unpaid']);
    // المشتري قاعد يدفع: البائع ما يقدر يلغي
    expect(actionsFor(view('awaiting_payment', 'seller', true), true)).toEqual([]);
    expect(actionsFor(view('held', 'seller'), true)).toEqual(['ship', 'seller_refund']);
    expect(actionsFor(view('held', 'buyer'), true)).toEqual(['release', 'buyer_cancel']);
    expect(actionsFor(view('shipped', 'buyer'), true)).toEqual(['release']);
    expect(actionsFor(view('shipped', 'visitor'), true)).toEqual([]);
    expect(actionsFor(view('released', 'buyer'), true)).toEqual([]);
  });
  it('marks progress steps', () => {
    expect(steps('held').map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(steps('released').every((s) => s.state === 'done')).toBe(true);
    expect(steps('cancelled').every((s) => s.state === 'todo')).toBe(true);
  });
  it('validates the new deal form', () => {
    expect(validateDeal({ shop_name: ' عطور  الورد ', title: 'عود', description: '', price: '25.5' })).toEqual({ ok: true, value: { shop_name: 'عطور الورد', title: 'عود', description: null, price_fils: 25500 } });
    expect(validateDeal({ shop_name: '', title: 'x', description: '', price: '5' }).ok).toBe(false);
    expect(validateDeal({ shop_name: 'a', title: '', description: '', price: '5' }).ok).toBe(false);
    expect(validateDeal({ shop_name: 'a', title: 'b', description: '', price: '0.5' }).ok).toBe(false);
    expect(validateDeal({ shop_name: 'a', title: 'b', description: 'x'.repeat(501), price: '5' }).ok).toBe(false);
  });
  it('parses routes', () => {
    expect(parseRoute('/', '')).toEqual({ name: 'home' });
    expect(parseRoute(`/d/${DEAL_ID}`, '?paid=1')).toEqual({ name: 'deal', id: DEAL_ID, paid: true });
    expect(parseRoute(`/d/${DEAL_ID.toUpperCase()}/`, '')).toEqual({ name: 'deal', id: DEAL_ID, paid: false });
    expect(parseRoute('/d/not-a-uuid', '')).toEqual({ name: 'not_found' });
    expect(parseRoute('/x', '')).toEqual({ name: 'not_found' });
  });
  it('maps function error codes to Arabic', () => {
    expect(friendlyError(new Error('own_deal'))).toContain('صفقتك');
    expect(friendlyError(new Error('reserved'))).toContain('مشتري ثاني');
    expect(friendlyError(new Error('stripe_conflict'))).toContain('تغيرت');
    expect(friendlyError(new TypeError('Load failed'))).toContain('الإنترنت');
    expect(friendlyError(Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }))).toContain('الإنترنت');
  });
});

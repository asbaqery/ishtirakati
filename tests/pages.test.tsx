// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DealPage } from '../src/components/DealPage';
import { Home } from '../src/components/Home';
import type { DealsApi } from '../src/lib/api';
import type { DealView } from '../src/lib/deals';

const ID = '11111111-2222-4333-8444-555555555555';
const db = { auth: {} } as unknown as SupabaseClient;

const deal = (o: Partial<DealView> = {}): DealView => ({
  id: ID, shop_name: 'عطور الورد', title: 'عطر عود', description: null, price_fils: 25500, status: 'awaiting_payment',
  created_at: '2026-11-14T10:00:00Z', paid_at: null, shipped_at: null, released_at: null, cancelled_at: null,
  is_seller: false, is_buyer: false, reserved_by_other: false, ...o,
});

function fakeApi(start: DealView | null): DealsApi & { current: () => DealView | null } {
  let d = start;
  return {
    current: () => d,
    create: vi.fn(async () => ({ id: ID })),
    mine: vi.fn(async () => []),
    get: vi.fn(async () => d),
    markShipped: vi.fn(async () => { d = d && { ...d, status: 'shipped', shipped_at: '2026-11-14T11:00:00Z' }; }),
    cancelUnpaid: vi.fn(async () => { d = d && { ...d, status: 'cancelled' }; }),
    startCheckout: vi.fn(async () => 'https://checkout.stripe.com/c/pay/cs_test_x'),
    act: vi.fn(async (_id: string, action: 'release' | 'cancel') => { d = d && { ...d, status: action === 'release' ? 'released' : 'cancelled' }; }),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DealPage', () => {
  it('a visitor sees the deal and is asked to sign in before paying', async () => {
    const api = fakeApi(deal());
    render(<DealPage db={db} id={ID} paid={false} loggedIn={false} api={api} />);
    expect(await screen.findByText('عطر عود')).toBeTruthy();
    expect(screen.getByText('25.500 د.ك')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'سجّل دخول عشان تدفع' }));
    expect(screen.getByRole('form', { name: 'تسجيل الدخول' })).toBeTruthy();
    expect(api.startCheckout).not.toHaveBeenCalled();
  });

  it('a signed-in buyer starts a held payment', async () => {
    const api = fakeApi(deal());
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost:5300' });
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ادفع بأمان (المبلغ ينحجز)' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_x'));
    vi.unstubAllGlobals();
  });

  it('the seller marks shipped, then the buyer confirms and the money is released', async () => {
    const api = fakeApi(deal({ status: 'held', is_seller: true, paid_at: '2026-11-14T10:30:00Z' }));
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={api} />);
    expect((await screen.findByTestId('status')).textContent).toBe('المبلغ محجوز');
    fireEvent.click(screen.getByRole('button', { name: 'تم الشحن' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('انشحن الطلب'));
    expect(api.markShipped).toHaveBeenCalledWith(ID);
    cleanup();

    const buyerApi = fakeApi(deal({ status: 'shipped', is_buyer: true }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={buyerApi} />);
    expect(screen.queryByRole('button', { name: 'ألغِ الطلب وفك الحجز' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'استلمت الطلب ✓ (حوّل المبلغ للبائع)' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('انتقل المبلغ للبائع'));
    expect(buyerApi.act).toHaveBeenCalledWith(ID, 'release');
  });

  it('the buyer can cancel before shipping, and nothing happens if they back out of the confirm', async () => {
    const api = fakeApi(deal({ status: 'held', is_buyer: true }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={api} />);
    const cancel = await screen.findByRole('button', { name: 'ألغِ الطلب وفك الحجز' });
    fireEvent.click(cancel);
    expect(api.act).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('انلغت الصفقة'));
    expect(api.act).toHaveBeenCalledWith(ID, 'cancel');
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('after returning from Stripe it waits for the webhook instead of trusting the URL', async () => {
    const api = fakeApi(deal({ is_buyer: true }));
    vi.stubGlobal('history', { ...window.history, replaceState: vi.fn() });
    render(<DealPage db={db} id={ID} paid loggedIn api={api} />);
    expect(await screen.findByText('جاري التحقق من الدفع…')).toBeTruthy();
    // الـWebhook يحجز المبلغ
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(deal({ is_buyer: true, status: 'held' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('المبلغ محجوز'), { timeout: 4000 });
    expect(screen.queryByText('جاري التحقق من الدفع…')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('keeps checking after a failed poll and shows no stale error', async () => {
    const api = fakeApi(deal({ is_buyer: true }));
    vi.stubGlobal('history', { ...window.history, replaceState: vi.fn() });
    render(<DealPage db={db} id={ID} paid loggedIn api={api} />);
    await screen.findByText('جاري التحقق من الدفع…');
    const get = api.get as ReturnType<typeof vi.fn>;
    get.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(deal({ is_buyer: true, status: 'held' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('المبلغ محجوز'), { timeout: 7000 });
    expect(screen.queryByRole('alert')).toBeNull();
    vi.unstubAllGlobals();
  }, 10000);

  it('the seller cannot cancel while a buyer is paying', async () => {
    const api = fakeApi(deal({ is_seller: true, reserved_by_other: true }));
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={api} />);
    expect(await screen.findByText(/في مشتري قاعد يدفع الحين/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ألغِ الصفقة' })).toBeNull();
  });

  it('a second buyer cannot pay while the deal is reserved', async () => {
    const api = fakeApi(deal({ reserved_by_other: true }));
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={api} />);
    expect(await screen.findByText('في مشتري ثاني قاعد يدفع هالصفقة الحين.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ادفع/ })).toBeNull();
  });

  it('shows an Arabic error when the server refuses', async () => {
    const api = fakeApi(deal({ status: 'held', is_seller: true }));
    api.markShipped = vi.fn(async () => { throw new Error('not_allowed'); });
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'تم الشحن' }));
    expect((await screen.findByRole('alert')).textContent).toContain('حالة الصفقة تغيرت');
  });

  it('shows not found for an unknown link', async () => {
    render(<DealPage db={db} id={ID} paid={false} loggedIn api={fakeApi(null)} />);
    expect(await screen.findByText('ما لقينا هالصفقة')).toBeTruthy();
  });
});

describe('Home', () => {
  it('creates a deal and shows the share link', async () => {
    const api = fakeApi(null);
    render(<Home db={db} userId="seller-1" api={api} />);
    const form = screen.getByRole('form', { name: 'صفقة جديدة' });
    const q = within(form);
    fireEvent.change(q.getByLabelText('اسم متجرك'), { target: { value: 'عطور الورد' } });
    fireEvent.change(q.getByLabelText('المنتج'), { target: { value: 'عطر عود' } });
    fireEvent.change(q.getByLabelText('السعر بالدينار'), { target: { value: '25.5' } });
    expect(q.getByText(/\$82\.88/)).toBeTruthy();
    fireEvent.click(q.getByRole('button', { name: 'سوّ رابط الصفقة' }));
    expect(await screen.findByText(`${window.location.origin}/d/${ID}`)).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith({ shop_name: 'عطور الورد', title: 'عطر عود', description: null, price_fils: 25500 });
    expect(screen.getByRole('link', { name: 'أرسله بالواتساب' }).getAttribute('href')).toContain('wa.me');
  });

  it('rejects a price under 1 KWD before calling the database', async () => {
    const api = fakeApi(null);
    render(<Home db={db} userId="seller-1" api={api} />);
    const q = within(screen.getByRole('form', { name: 'صفقة جديدة' }));
    fireEvent.change(q.getByLabelText('اسم متجرك'), { target: { value: 'متجر' } });
    fireEvent.change(q.getByLabelText('المنتج'), { target: { value: 'منتج' } });
    fireEvent.change(q.getByLabelText('السعر بالدينار'), { target: { value: '0.5' } });
    fireEvent.click(q.getByRole('button', { name: 'سوّ رابط الصفقة' }));
    expect((await q.findByRole('alert')).textContent).toContain('بين 1 و1000');
    expect(api.create).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Dashboard } from '../src/components/Dashboard';
import type { SubscriptionsApi } from '../src/lib/api';
import type { Subscription, SubscriptionInput } from '../src/lib/subscriptions';

/** قاعدة بيانات وهمية في الذاكرة بنفس واجهة subscriptionsApi */
function fakeApi(initial: Subscription[] = []) {
  let rows = [...initial];
  let n = 0;
  const api: SubscriptionsApi = {
    list: vi.fn(async () => [...rows]),
    create: vi.fn(async (input: SubscriptionInput) => {
      const row = { id: `id-${++n}`, ...input };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, input: SubscriptionInput) => {
      const row = { id, ...input };
      rows = rows.map((r) => (r.id === id ? row : r));
      return row;
    }),
    remove: vi.fn(async (id: string) => {
      rows = rows.filter((r) => r.id !== id);
    }),
  };
  return { api, rows: () => rows };
}

const db = { auth: { signOut: vi.fn() } } as unknown as SupabaseClient;
const total = () => screen.getByTestId('monthly-total').textContent;

function fillForm(form: HTMLElement, v: { name?: string; price?: string; cycle?: string; date?: string }) {
  const q = within(form);
  if (v.name !== undefined) fireEvent.change(q.getByLabelText('اسم الاشتراك'), { target: { value: v.name } });
  if (v.price !== undefined) fireEvent.change(q.getByLabelText('السعر بالدينار'), { target: { value: v.price } });
  if (v.cycle !== undefined) fireEvent.change(q.getByLabelText('الدفع'), { target: { value: v.cycle } });
  if (v.date !== undefined) fireEvent.change(q.getByLabelText('تاريخ التجديد الجاي'), { target: { value: v.date } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 12, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Dashboard (main flow)', () => {
  it('adds, edits and deletes subscriptions and keeps the totals right', async () => {
    const { api, rows } = fakeApi();
    render(<Dashboard db={db} email="me@example.com" api={api} />);
    expect(await screen.findByText(/ما عندك اشتراكات للحين/)).toBeTruthy();
    expect(total()).toBe('0.000 د.ك');

    const addForm = screen.getByRole('form', { name: 'إضافة اشتراك' });
    fillForm(addForm, { name: 'Netflix', price: '3.5', date: '2026-11-14' });
    fireEvent.click(within(addForm).getByRole('button', { name: 'أضف الاشتراك' }));
    await waitFor(() => expect(total()).toBe('3.500 د.ك'));
    expect(api.create).toHaveBeenCalledWith({ name: 'Netflix', price_fils: 3500, cycle: 'monthly', next_renewal: '2026-11-14' });
    // يظهر في قسم التجديدات القريبة
    const soon = screen.getByRole('region', { name: /التجديدات الجاية/ });
    expect(within(soon).getByText('Netflix')).toBeTruthy();
    expect(within(soon).getByText(/بعد 3 أيام/)).toBeTruthy();

    fillForm(addForm, { name: 'iCloud', price: '12', cycle: 'yearly', date: '2027-03-01' });
    fireEvent.click(within(addForm).getByRole('button', { name: 'أضف الاشتراك' }));
    await waitFor(() => expect(total()).toBe('4.500 د.ك'));
    expect(within(soon).queryByText('iCloud')).toBeNull();

    // الترتيب: الأقرب تجديدًا أول
    const all = screen.getByRole('region', { name: /كل اشتراكاتك/ });
    const names = within(all).getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent);
    expect(names).toEqual(['Netflix', 'iCloud']);

    fireEvent.click(screen.getByRole('button', { name: 'تعديل Netflix' }));
    const editForm = screen.getByRole('form', { name: 'تعديل Netflix' });
    fillForm(editForm, { price: '4' });
    fireEvent.click(within(editForm).getByRole('button', { name: 'احفظ التعديل' }));
    await waitFor(() => expect(total()).toBe('5.000 د.ك'));
    expect(api.update).toHaveBeenCalledWith('id-1', { name: 'Netflix', price_fils: 4000, cycle: 'monthly', next_renewal: '2026-11-14' });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'حذف iCloud' }));
    await waitFor(() => expect(total()).toBe('4.000 د.ك'));
    expect(rows().map((r) => r.name)).toEqual(['Netflix']);
  });

  it('keeps the subscription when delete is cancelled', async () => {
    const { api } = fakeApi([{ id: 'a', name: 'Shahid', price_fils: 2000, cycle: 'monthly', next_renewal: '2026-12-01' }]);
    render(<Dashboard db={db} email="me@example.com" api={api} />);
    await screen.findByText('Shahid');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'حذف Shahid' }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(total()).toBe('2.000 د.ك');
  });

  it('rejects bad input before calling the database', async () => {
    const { api } = fakeApi();
    render(<Dashboard db={db} email="me@example.com" api={api} />);
    await screen.findByText(/ما عندك اشتراكات للحين/);
    const addForm = screen.getByRole('form', { name: 'إضافة اشتراك' });
    fillForm(addForm, { name: '', price: '3' });
    fireEvent.click(within(addForm).getByRole('button', { name: 'أضف الاشتراك' }));
    expect((await within(addForm).findByRole('alert')).textContent).toContain('اسم الاشتراك');
    fillForm(addForm, { name: 'Gym', price: 'ببلاش' });
    fireEvent.click(within(addForm).getByRole('button', { name: 'أضف الاشتراك' }));
    expect((await within(addForm).findByRole('alert')).textContent).toContain('السعر');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('shows a database error in Arabic and keeps the form filled', async () => {
    const { api } = fakeApi();
    api.create = vi.fn(async () => { throw new Error('new row violates row-level security policy'); });
    render(<Dashboard db={db} email="me@example.com" api={api} />);
    await screen.findByText(/ما عندك اشتراكات للحين/);
    const addForm = screen.getByRole('form', { name: 'إضافة اشتراك' });
    fillForm(addForm, { name: 'Gym', price: '15' });
    fireEvent.click(within(addForm).getByRole('button', { name: 'أضف الاشتراك' }));
    expect((await within(addForm).findByRole('alert')).textContent).toContain('سجّل دخول');
    expect((within(addForm).getByLabelText('اسم الاشتراك') as HTMLInputElement).value).toBe('Gym');
  });

  it('shows a retry when loading fails', async () => {
    const { api } = fakeApi();
    api.list = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue([]);
    render(<Dashboard db={db} email="me@example.com" api={api} />);
    expect((await screen.findByRole('alert')).textContent).toContain('الإنترنت');
    fireEvent.click(screen.getByRole('button', { name: 'جرب مرة ثانية' }));
    expect(await screen.findByText(/ما عندك اشتراكات للحين/)).toBeTruthy();
  });

  it('rolls a passed renewal date forward', async () => {
    const { api } = fakeApi([{ id: 'a', name: 'Gym', price_fils: 15000, cycle: 'monthly', next_renewal: '2026-10-12' }]);
    render(<Dashboard db={db} email="me@example.com" api={api} />);
    const soon = await screen.findByRole('region', { name: /التجديدات الجاية/ });
    expect(within(soon).getByText(/باجر/)).toBeTruthy();
  });
});

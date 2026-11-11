import { describe, expect, it } from 'vitest';
import {
  byNextRenewal, daysBetween, daysLabel, formatKwd, isValidDate, monthlyFils, monthlyTotal,
  parseKwd, todayIso, upcomingRenewal, validateInput, type Subscription,
} from '../src/lib/subscriptions';
import { friendlyError } from '../src/lib/api';

const sub = (o: Partial<Subscription>): Subscription => ({ id: 'x', name: 'Netflix', price_fils: 3500, cycle: 'monthly', next_renewal: '2026-11-20', ...o });

describe('parseKwd', () => {
  it.each([
    ['3.5', 3500], ['3.500', 3500], ['0.250', 250], ['12', 12000], ['٣٫٥', 3500], ['2,75', 2750], [' 1.1 ', 1100],
  ])('parses %s', (raw, fils) => expect(parseKwd(raw)).toBe(fils));
  it.each(['', '0', '0.000', '-1', '1.2345', 'abc', '1e3', '100000', '3.5.1'])('rejects %s', (raw) => expect(parseKwd(raw)).toBeNull());
});

describe('money', () => {
  it('formats fils as KWD with 3 decimals', () => expect(formatKwd(3500)).toBe('3.500 د.ك'));
  it('turns a yearly price into a monthly cost', () => {
    expect(monthlyFils({ price_fils: 24000, cycle: 'yearly' })).toBe(2000);
    expect(monthlyFils({ price_fils: 10000, cycle: 'yearly' })).toBe(833);
    expect(monthlyFils({ price_fils: 3500, cycle: 'monthly' })).toBe(3500);
  });
  it('sums the monthly total', () => {
    expect(monthlyTotal([{ price_fils: 3500, cycle: 'monthly' }, { price_fils: 24000, cycle: 'yearly' }])).toBe(5500);
    expect(monthlyTotal([])).toBe(0);
  });
});

describe('dates', () => {
  it('validates calendar dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('20-1-1')).toBe(false);
  });
  it('uses the local calendar day', () => expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05'));
  it('counts days and labels them', () => {
    expect(daysBetween('2026-11-11', '2026-11-12')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysLabel(0)).toBe('اليوم');
    expect(daysLabel(1)).toBe('باجر');
    expect(daysLabel(2)).toBe('بعد يومين');
    expect(daysLabel(5)).toBe('بعد 5 أيام');
    expect(daysLabel(30)).toBe('بعد 30 يوم');
  });
});

describe('upcomingRenewal', () => {
  it('keeps a future or same-day date', () => {
    expect(upcomingRenewal(sub({ next_renewal: '2026-11-20' }), '2026-11-11')).toBe('2026-11-20');
    expect(upcomingRenewal(sub({ next_renewal: '2026-11-11' }), '2026-11-11')).toBe('2026-11-11');
  });
  it('rolls a passed monthly date forward', () => {
    expect(upcomingRenewal(sub({ next_renewal: '2026-09-05' }), '2026-11-11')).toBe('2026-12-05');
    expect(upcomingRenewal(sub({ next_renewal: '2026-10-11' }), '2026-11-11')).toBe('2026-11-11');
  });
  it('keeps the day of month and clamps short months', () => {
    expect(upcomingRenewal(sub({ next_renewal: '2026-01-31' }), '2026-02-10')).toBe('2026-02-28');
    expect(upcomingRenewal(sub({ next_renewal: '2026-01-31' }), '2026-03-01')).toBe('2026-03-31');
  });
  it('rolls a passed yearly date forward by years', () => {
    expect(upcomingRenewal(sub({ cycle: 'yearly', next_renewal: '2024-03-01' }), '2026-11-11')).toBe('2027-03-01');
    expect(upcomingRenewal(sub({ cycle: 'yearly', next_renewal: '2024-02-29' }), '2026-11-11')).toBe('2027-02-28');
  });
});

describe('byNextRenewal', () => {
  it('sorts by the real next renewal with days left', () => {
    const rows = byNextRenewal([
      sub({ id: 'a', name: 'Gym', next_renewal: '2026-12-01' }),
      sub({ id: 'b', name: 'iCloud', next_renewal: '2026-10-13' }), // صار 13 نوفمبر
      sub({ id: 'c', name: 'Shahid', next_renewal: '2026-11-11' }),
    ], '2026-11-11');
    expect(rows.map((r) => [r.id, r.renewal, r.days])).toEqual([['c', '2026-11-11', 0], ['b', '2026-11-13', 2], ['a', '2026-12-01', 20]]);
  });
});

describe('validateInput', () => {
  const ok = { name: '  Netflix   Premium ', price: '4.5', cycle: 'monthly', next_renewal: '2026-11-20' };
  it('returns clean values', () => {
    expect(validateInput(ok)).toEqual({ ok: true, value: { name: 'Netflix Premium', price_fils: 4500, cycle: 'monthly', next_renewal: '2026-11-20' } });
  });
  it.each([
    [{ name: ' ' }], [{ name: 'x'.repeat(61) }], [{ price: '0' }], [{ price: 'free' }], [{ cycle: 'weekly' }], [{ next_renewal: '' }], [{ next_renewal: '2026-13-01' }],
  ])('rejects %j', (patch) => expect(validateInput({ ...ok, ...patch }).ok).toBe(false));
});

describe('friendlyError', () => {
  it('maps Supabase errors to Arabic', () => {
    expect(friendlyError({ message: 'Invalid login credentials' })).toBe('الإيميل أو كلمة المرور غلط.');
    expect(friendlyError(new Error('User already registered'))).toContain('مسجل');
    expect(friendlyError(new TypeError('Failed to fetch'))).toContain('الإنترنت');
    expect(friendlyError({ message: 'new row violates row-level security policy' })).toContain('سجّل دخول');
    expect(friendlyError('something odd')).toBe('صار خطأ. جرب مرة ثانية.');
  });
});

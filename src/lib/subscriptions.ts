/** منطق نقي بلا اتصال بالشبكة، حتى تغطيه الاختبارات. المبالغ أعداد صحيحة بالفلس (1 د.ك = 1000 فلس). */

export type Cycle = 'monthly' | 'yearly';

export interface Subscription {
  id: string;
  name: string;
  price_fils: number;
  cycle: Cycle;
  /** تاريخ التجديد كما أدخله المستخدم بصيغة YYYY-MM-DD */
  next_renewal: string;
  created_at?: string;
}

export interface SubscriptionInput {
  name: string;
  price_fils: number;
  cycle: Cycle;
  next_renewal: string;
}

export const MAX_NAME = 60;
/** 99,999.999 د.ك */
export const MAX_PRICE_FILS = 99_999_999;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** يحول نصًا مثل "3.5" أو "٣٫٥" إلى فلس. يرجع null لأي قيمة غير صالحة. */
export function parseKwd(raw: string): number | null {
  const t = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  // "1,200" ممكن تكون ألف ومية أو دينار وفلوس، فنرفضها بدل ما نخمّن
  if (/,\d{3}$/.test(t)) return null;
  const s = t.replace(/[٫,]/g, '.');
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const fils = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  return fils > 0 && fils <= MAX_PRICE_FILS ? fils : null;
}

export function formatKwd(fils: number): string {
  return `${(fils / 1000).toFixed(3)} د.ك`;
}

/** الكلفة الشهرية: السنوي ينقسم على 12 */
export function monthlyFils(s: Pick<Subscription, 'price_fils' | 'cycle'>): number {
  return s.cycle === 'yearly' ? Math.round(s.price_fils / 12) : s.price_fils;
}

/** نقرّب مرة وحدة على المجموع، مو على كل اشتراك */
export function monthlyTotal(subs: Pick<Subscription, 'price_fils' | 'cycle'>[]): number {
  return Math.round(subs.reduce((sum, s) => sum + (s.cycle === 'yearly' ? s.price_fils / 12 : s.price_fils), 0));
}

/** المجموع السنوي بالضبط: الشهري × 12 والسنوي كما هو */
export function yearlyTotal(subs: Pick<Subscription, 'price_fils' | 'cycle'>[]): number {
  return subs.reduce((sum, s) => sum + (s.cycle === 'yearly' ? s.price_fils : s.price_fils * 12), 0);
}

export function isValidDate(iso: string): boolean {
  const m = DATE_RE.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** تاريخ اليوم حسب جهاز المستخدم */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** يضيف أشهرًا مع تثبيت يوم الشهر: 31 يناير + شهر = آخر فبراير */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toIso(Date.UTC(year, month, Math.min(d, lastDay)));
}

/** التجديد الفعلي القادم: إذا مر التاريخ المسجل نكمل الدورات حتى نصل لليوم أو بعده */
export function upcomingRenewal(s: Pick<Subscription, 'cycle' | 'next_renewal'>, today: string): string {
  if (!isValidDate(s.next_renewal) || s.next_renewal >= today) return s.next_renewal;
  const step = s.cycle === 'yearly' ? 12 : 1;
  for (let n = step; n <= 12 * 200; n += step) {
    const next = addMonths(s.next_renewal, n);
    if (next >= today) return next;
  }
  return s.next_renewal;
}

export function daysBetween(fromIso: string, toIsoDate: string): number {
  return Math.round((toUtc(toIsoDate) - toUtc(fromIso)) / 86_400_000);
}

export function daysLabel(days: number): string {
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'باجر';
  if (days === 2) return 'بعد يومين';
  if (days <= 10) return `بعد ${days} أيام`;
  return `بعد ${days} يوم`;
}

export interface RenewalRow extends Subscription {
  renewal: string;
  days: number;
}

/** كل الاشتراكات مرتبة حسب أقرب تجديد */
export function byNextRenewal(subs: Subscription[], today: string): RenewalRow[] {
  return subs
    .map((s) => {
      const renewal = upcomingRenewal(s, today);
      return { ...s, renewal, days: daysBetween(today, renewal) };
    })
    .sort((a, b) => a.renewal.localeCompare(b.renewal) || a.name.localeCompare(b.name, 'ar'));
}

export type ValidationResult = { ok: true; value: SubscriptionInput } | { ok: false; error: string };

export function validateInput(form: { name: string; price: string; cycle: string; next_renewal: string }): ValidationResult {
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'اكتب اسم الاشتراك.' };
  if (name.length > MAX_NAME) return { ok: false, error: `اسم الاشتراك أطول من ${MAX_NAME} حرف.` };
  const price_fils = parseKwd(form.price);
  if (price_fils === null) return { ok: false, error: 'اكتب السعر بالدينار، مثل 3.500' };
  if (form.cycle !== 'monthly' && form.cycle !== 'yearly') return { ok: false, error: 'اختار شهري أو سنوي.' };
  if (!isValidDate(form.next_renewal)) return { ok: false, error: 'اختار تاريخ التجديد الجاي.' };
  return { ok: true, value: { name, price_fils, cycle: form.cycle, next_renewal: form.next_renewal } };
}

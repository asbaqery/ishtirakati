import { useState, type FormEvent } from 'react';
import { MAX_NAME, todayIso, validateInput, type Subscription, type SubscriptionInput } from '../lib/subscriptions';

interface Props {
  initial?: Subscription;
  onSubmit: (input: SubscriptionInput) => Promise<void>;
  onCancel?: () => void;
}

const priceText = (fils: number) => String(fils / 1000);

export function SubscriptionForm({ initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? priceText(initial.price_fils) : '');
  const [cycle, setCycle] = useState<string>(initial?.cycle ?? 'monthly');
  const [nextRenewal, setNextRenewal] = useState(initial?.next_renewal ?? todayIso());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateInput({ name, price, cycle, next_renewal: nextRenewal });
    if (!v.ok) return setError(v.error);
    setError(null);
    setBusy(true);
    try {
      await onSubmit(v.value);
      if (!initial) {
        setName('');
        setPrice('');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate aria-label={initial ? `تعديل ${initial.name}` : 'إضافة اشتراك'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">اسم الاشتراك</span>
          <input className="field" maxLength={MAX_NAME} placeholder="مثل Netflix" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">السعر بالدينار</span>
          <input className="field" inputMode="decimal" dir="ltr" placeholder="3.500" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">الدفع</span>
          <select className="field" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option value="monthly">شهري</option>
            <option value="yearly">سنوي</option>
          </select>
        </label>
        <label className="block">
          <span className="label">تاريخ التجديد الجاي</span>
          <input className="field" type="date" dir="ltr" value={nextRenewal} onChange={(e) => setNextRenewal(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? 'لحظة…' : initial ? 'احفظ التعديل' : 'أضف الاشتراك'}
        </button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>إلغاء</button>}
      </div>
    </form>
  );
}

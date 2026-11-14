import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedOrigin } from './logic.ts';

/** CORS: يسمح بموقعنا بس (SITE_URL) وlocalhost للتجربة */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'), Deno.env.get('SITE_URL') ?? '');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        }
      : {}),
  };
}

export const reply = (req: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(req) });

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service credentials are not available');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** المستخدم من توكن الجلسة اللي يرسله المتصفح. null إذا التوكن ناقص أو منتهي */
export async function userFromRequest(req: Request, db: ReturnType<typeof adminClient>) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

export function stripeTestKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) throw new Error('STRIPE_SECRET_KEY must be a Stripe test-mode key');
  return key;
}

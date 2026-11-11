import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * المفتاح العام (anon) مسموح يكون في المتصفح: الحماية من سياسات RLS في قاعدة البيانات،
 * وكل مستخدم يقدر يقرأ ويعدل صفوفه هو بس.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://syukyhhgpvpfyqyzcimm.supabase.co';
const SUPABASE_PUBLIC_KEY = 'sb_publishable_aSSDwkXS3xZgtAHOb4e3Uw_1VLVU3J6';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);

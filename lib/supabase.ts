import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

// Browser client — uses anon key, safe to expose to the client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client — uses service role key, server-side only
// Never import this in client components
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

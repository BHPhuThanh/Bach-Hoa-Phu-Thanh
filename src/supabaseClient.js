import { createClient } from '@supabase/supabase-js'

let clientSingleton = null

/**
 * @returns {boolean}
 */
export function isSupabaseConfigured() {
  const url = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
  const key = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.trim().length > 0 && typeof key === 'string' && key.trim().length > 0
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null
  if (clientSingleton) return clientSingleton
  const url = String(import.meta.env.VITE_SUPABASE_URL).trim()
  const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
  clientSingleton = createClient(url, key)
  return clientSingleton
}

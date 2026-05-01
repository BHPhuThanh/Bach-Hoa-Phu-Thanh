import { createClient } from '@supabase/supabase-js'

let clientSingleton = null

export function getSupabaseCredentialsFromBuild() {
  const url = String(import.meta.env?.VITE_SUPABASE_URL ?? '').trim()
  const key = String(import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '').trim()
  return { url, key }
}

/**
 * @returns {boolean}
 */
export function isSupabaseConfigured() {
  const { url, key } = getSupabaseCredentialsFromBuild()
  return url.length > 0 && key.length > 0
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function getSupabaseClient() {
  const { url, key } = getSupabaseCredentialsFromBuild()
  if (!url || !key) return null
  if (clientSingleton) return clientSingleton

  console.log('[Supabase] init credentials', {
    url,
    anonKeyPreview: `${key.slice(0, 5)}…`,
  })

  clientSingleton = createClient(url, key, {
    global: {
      /** Tránh HTTP cache (F5 / refetch sau ghi vẫn thấy bản cũ). */
      fetch: (input, init = {}) =>
        fetch(input, {
          ...init,
          cache: 'no-store',
        }),
    },
  })
  return clientSingleton
}

import { createClient } from '@supabase/supabase-js'

/**
 * Được Vite thay bằng chuỗi cố định lúc build (xem `define` trong vite.config.js + loadEnv).
 * @type {string}
 */
// eslint-disable-next-line no-undef
const BUILT_VITE_SUPABASE_URL = __CSV_PREVIEW_VITE_SUPABASE_URL__
/**
 * @type {string}
 */
// eslint-disable-next-line no-undef
const BUILT_VITE_SUPABASE_ANON_KEY = __CSV_PREVIEW_VITE_SUPABASE_ANON_KEY__

let clientSingleton = null

/** URL + anon key đã nhúng trong bundle (sau khi Vite build). */
export function getSupabaseCredentialsFromBuild() {
  const envUrl = String(import.meta.env?.VITE_SUPABASE_URL || '').trim()
  const envKey = String(import.meta.env?.VITE_SUPABASE_ANON_KEY || '').trim()
  const url = envUrl || String(BUILT_VITE_SUPABASE_URL).trim()
  const key = envKey || String(BUILT_VITE_SUPABASE_ANON_KEY).trim()
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
  clientSingleton = createClient(url, key, {
    global: {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
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

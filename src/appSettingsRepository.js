import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

const ADMIN_PIN_KEY = 'admin_pin'

async function fetchSettingValue(key) {
  const sb = getSupabaseClient()
  if (!sb || !isSupabaseConfigured()) {
    return { ok: false, skipped: true, error: new Error('Supabase chưa cấu hình') }
  }
  try {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', key).single()
    if (error) return { ok: false, error, code: error.code, message: error.message }
    return { ok: true, value: String(data?.value ?? '') }
  } catch (error) {
    return { ok: false, error }
  }
}

export async function verifyAdminPinSupabase(pinRaw) {
  const pin = String(pinRaw ?? '').trim()
  const got = await fetchSettingValue(ADMIN_PIN_KEY)
  if (!got.ok) return got
  return { ok: true, matched: pin.length > 0 && pin === String(got.value ?? '').trim() }
}

export async function updateAdminPinSupabase(newPinRaw) {
  const sb = getSupabaseClient()
  if (!sb || !isSupabaseConfigured()) {
    return { ok: false, skipped: true, error: new Error('Supabase chưa cấu hình') }
  }
  const next = String(newPinRaw ?? '').trim()
  try {
    const { error } = await sb.from('app_settings').update({ value: next }).eq('key', ADMIN_PIN_KEY)
    if (error) return { ok: false, error, code: error.code, message: error.message }
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

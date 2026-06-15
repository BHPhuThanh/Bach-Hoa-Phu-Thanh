import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

const REALTIME_CHANNEL = 'products-changes'

/** @type {import('@supabase/supabase-js').RealtimeChannel | null} */
let channel = null
/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let boundClient = null
/** @type {Set<(payload: object) => void>} */
const listeners = new Set()

let retryTimer = null
let retryDelayMs = 2000

function dispatchPayload(payload) {
  for (const listener of listeners) {
    try {
      listener(payload)
    } catch (err) {
      console.warn('[Realtime products] listener lỗi:', err)
    }
  }
}

function scheduleReconnect() {
  if (retryTimer != null || listeners.size === 0) return
  const delay = Math.min(retryDelayMs, 30000)
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    retryDelayMs = Math.min(retryDelayMs * 2, 30000)
    channel = null
    ensureProductsRealtimeChannel()
  }, delay)
}

function ensureProductsRealtimeChannel() {
  if (!isSupabaseConfigured() || listeners.size === 0) return
  const sb = getSupabaseClient()
  if (!sb) return
  if (channel && boundClient === sb) return

  if (channel) {
    try {
      sb.removeChannel(channel)
    } catch {
      /* noop */
    }
    channel = null
  }

  boundClient = sb
  try {
    channel = sb
      .channel(REALTIME_CHANNEL)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        (payload) => dispatchPayload(payload)
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          retryDelayMs = 2000
          console.log('[Realtime products] đã kết nối (singleton).')
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          console.warn(`[Realtime products] kênh ${status} — thử kết nối lại…`)
          scheduleReconnect()
        }
      })
  } catch (err) {
    console.warn('[Realtime products] không tạo được kênh:', err)
    scheduleReconnect()
  }
}

/**
 * Đăng ký listener Realtime bảng `products`. WebSocket singleton — không đóng khi React unmount tab con.
 * @param {(payload: object) => void} listener
 * @returns {() => void} gỡ listener (giữ nguyên kết nối nếu còn listener khác)
 */
export function subscribeProductsRealtime(listener) {
  listeners.add(listener)
  ensureProductsRealtimeChannel()
  return () => {
    listeners.delete(listener)
  }
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  APP_NOTIFICATIONS_BUMP_EVENT,
  clearAppNotificationById,
  loadAppNotifications,
  markAllLocalNotificationsRead,
} from './appNotificationsStorage.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import {
  cleanOldNotificationsInSupabase,
  fetchNotificationsFromSupabase,
  markAllNotificationsReadInSupabase,
} from './notificationsRepository.js'
import { useRoleStore } from './roleStore.js'

const NotificationsContext = createContext(null)

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications phải nằm trong <NotificationsProvider>.')
  }
  return ctx
}

/** Fetch boot duy nhất / phiên (không gọi lại khi đổi tab). */
let bootPromise = null
let bootSellerId = null

function fetchNotificationsBootOnce(activeSellerId) {
  const sid = String(activeSellerId ?? '').trim() || 'admin'
  if (bootPromise && bootSellerId === sid) return bootPromise
  bootSellerId = sid
  bootPromise = (async () => {
    if (!isSupabaseConfigured()) return []
    await cleanOldNotificationsInSupabase(sid)
    return fetchNotificationsFromSupabase(sid)
  })()
  return bootPromise
}

function normalizeSupabaseNotifications(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  let newestLowStock = null
  const otherNotifications = []
  for (const row of rows) {
    if (!row) continue
    if (String(row.kind || '').trim() === 'low_stock') {
      if (
        !newestLowStock ||
        Number(row.createdAtMs || 0) > Number(newestLowStock.createdAtMs || 0)
      ) {
        newestLowStock = row
      }
      continue
    }
    otherNotifications.push(row)
  }
  const merged = newestLowStock ? [newestLowStock, ...otherNotifications] : otherNotifications
  merged.sort((a, b) => Number(b?.createdAtMs || 0) - Number(a?.createdAtMs || 0))
  return merged
}

export function NotificationsProvider({ children }) {
  const { sellerId: activeSellerId } = useRoleStore()
  const [appCostChangeNotifications, setAppCostChangeNotifications] = useState(() =>
    loadAppNotifications()
  )
  const [supabaseNotifications, setSupabaseNotifications] = useState([])
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false)
  const [bootLoaded, setBootLoaded] = useState(false)

  /** Một lần khi mở web — không refetch khi remount tab / mở popover / focus. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchNotificationsBootOnce(activeSellerId)
        if (!cancelled) {
          setSupabaseNotifications(normalizeSupabaseNotifications(rows))
        }
      } finally {
        if (!cancelled) setBootLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSellerId])

  /** Thông báo giá vốn local — chỉ đọc localStorage, không HTTP. */
  useEffect(() => {
    const syncLocal = () => setAppCostChangeNotifications(loadAppNotifications())
    window.addEventListener(APP_NOTIFICATIONS_BUMP_EVENT, syncLocal)
    window.addEventListener('storage', syncLocal)
    return () => {
      window.removeEventListener(APP_NOTIFICATIONS_BUMP_EVENT, syncLocal)
      window.removeEventListener('storage', syncLocal)
    }
  }, [])

  const mergeCreatedLowStockNotifications = useCallback((lowStockRows) => {
    if (!lowStockRows?.length) return
    setSupabaseNotifications((p) =>
      normalizeSupabaseNotifications([...(lowStockRows || []), ...(p || [])])
    )
  }, [])

  const markSupabaseNotificationRead = useCallback((n) => {
    if (!n?.id) return
    setSupabaseNotifications((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
    )
    if (isSupabaseConfigured()) {
      void getSupabaseClient()?.from('notifications').update({ is_read: true }).eq('id', n.id)
    }
  }, [])

  const markAllNotificationsRead = useCallback(async () => {
    if (markingAllNotifications) return
    setMarkingAllNotifications(true)
    setSupabaseNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setAppCostChangeNotifications([])
    markAllLocalNotificationsRead()
    try {
      if (isSupabaseConfigured()) {
        await markAllNotificationsReadInSupabase(activeSellerId)
      }
    } finally {
      setMarkingAllNotifications(false)
    }
  }, [markingAllNotifications, activeSellerId])

  const clearLocalNotificationById = useCallback((id) => {
    clearAppNotificationById(id)
    setAppCostChangeNotifications(loadAppNotifications())
  }, [])

  const supabaseUnreadCount = useMemo(
    () => supabaseNotifications.reduce((count, n) => count + (n?.is_read ? 0 : 1), 0),
    [supabaseNotifications]
  )

  const costNotifyCount = appCostChangeNotifications.length
  const totalNotifyCount = supabaseUnreadCount + costNotifyCount

  const mergedNotifications = useMemo(
    () =>
      [...supabaseNotifications, ...appCostChangeNotifications]
        .map((n) => ({
          ...n,
          source: n?.id && String(n.id).startsWith('cc-') ? 'local' : 'supabase',
        }))
        .sort((a, b) => Number(b?.createdAtMs || 0) - Number(a?.createdAtMs || 0)),
    [supabaseNotifications, appCostChangeNotifications]
  )

  const value = useMemo(
    () => ({
      bootLoaded,
      supabaseNotifications,
      appCostChangeNotifications,
      supabaseUnreadCount,
      totalNotifyCount,
      mergedNotifications,
      markingAllNotifications,
      mergeCreatedLowStockNotifications,
      markSupabaseNotificationRead,
      markAllNotificationsRead,
      clearLocalNotificationById,
    }),
    [
      bootLoaded,
      supabaseNotifications,
      appCostChangeNotifications,
      supabaseUnreadCount,
      totalNotifyCount,
      mergedNotifications,
      markingAllNotifications,
      mergeCreatedLowStockNotifications,
      markSupabaseNotificationRead,
      markAllNotificationsRead,
      clearLocalNotificationById,
    ]
  )

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  )
}

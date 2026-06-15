import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

/**
 * Chuông thông báo — chỉ UI. Không gọi API; nhận dữ liệu từ NotificationsProvider qua props.
 */
export default function NotificationBell({
  totalNotifyCount,
  mergedNotifications,
  markingAllNotifications,
  onMarkAllRead,
  onNotificationClick,
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const popoverRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      const t = e.target
      if (wrapRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onEsc = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [open])

  return (
    <div className="app-header-notify-wrap" ref={wrapRef}>
      <button
        type="button"
        className="app-header-icon-btn"
        aria-label={
          totalNotifyCount > 0
            ? `Thông báo — ${totalNotifyCount} mục chưa đọc`
            : 'Thông báo'
        }
        aria-expanded={open}
        title={totalNotifyCount > 0 ? `${totalNotifyCount} thông báo chưa đọc` : 'Thông báo'}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className="app-header-icon-svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {totalNotifyCount > 0 ? (
          <span className="app-header-notify-badge" aria-hidden>
            {totalNotifyCount > 99 ? '99+' : totalNotifyCount}
          </span>
        ) : null}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="app-header-low-stock-popover app-header-low-stock-popover--elevated"
              role="dialog"
              aria-label="Thông báo"
            >
              <div className="app-header-low-stock-popover-head">
                <span className="app-header-low-stock-popover-title">Thông báo</span>
                {totalNotifyCount > 0 ? (
                  <button
                    type="button"
                    className="app-header-notify-mark-all"
                    disabled={markingAllNotifications}
                    title="Đánh dấu tất cả đã đọc"
                    onClick={() => void onMarkAllRead?.()}
                  >
                    <span className="app-header-notify-mark-all-icon" aria-hidden>
                      ✓✓
                    </span>
                    Đọc tất cả
                  </button>
                ) : null}
              </div>
              <div className="app-header-low-stock-scroll">
                {mergedNotifications.length === 0 ? (
                  <p className="app-header-low-stock-empty">Chưa có thông báo</p>
                ) : (
                  <>
                    <div className="app-header-notify-section-h">Thông báo hệ thống</div>
                    <ul className="app-header-cost-notif-list">
                      {mergedNotifications.map((n) => (
                        <li
                          key={n.id}
                          className={`app-header-cost-notif-item${
                            n.source === 'supabase' && n.is_read
                              ? ' app-header-supabase-notif-item--read'
                              : ''
                          }`}
                        >
                          <button
                            type="button"
                            className="app-header-supabase-notif-btn"
                            onClick={() => {
                              setOpen(false)
                              onNotificationClick?.(n, n.source)
                            }}
                          >
                            <span className="app-header-notify-message-pre">{n.message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

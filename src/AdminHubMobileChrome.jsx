import { memo, useCallback, useState } from 'react'

const MOBILE_MQ = 768

/**
 * Thanh menu mobile: nút ☰ mở sheet toàn bộ tab + dock nhanh 4 mục + «Thêm».
 * Chỉ UI — gọi lại cùng `onAdminHubNavItemActivate` như thanh tab desktop.
 */
export const AdminHubMobileChrome = memo(function AdminHubMobileChrome({
  adminHubNavTabs,
  activeTab,
  onAdminHubNavItemActivate,
  closeSoloProductTabByVariantId,
  closeInboundDetailTabByOrderId,
  closePosDetailTabByOrderId,
  closePosReturnDetailTabByLedgerId,
  /** Các tab id hiển thị trên dock dưới (thứ tự trái → phải) */
  dockTabIds = ['overview', 'goods', 'inbound', 'orders'],
}) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const activate = useCallback(
    (id) => {
      onAdminHubNavItemActivate(id)
      setSheetOpen(false)
    },
    [onAdminHubNavItemActivate]
  )

  const renderTabButton = useCallback(
    (it) => {
      if (it.soloCloseVariantId) {
        return (
          <div key={it.id} className={`ah-mnav-sheet-pill${activeTab === it.id ? ' is-active' : ''}`}>
            <button type="button" className="ah-mnav-sheet-tab" onClick={() => activate(it.id)}>
              {it.label}
            </button>
            <button
              type="button"
              className="ah-mnav-sheet-tab-x"
              aria-label="Đóng tab"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                closeSoloProductTabByVariantId?.(it.soloCloseVariantId)
                closeSheet()
              }}
            >
              ×
            </button>
          </div>
        )
      }
      if (it.detailCloseOrderId) {
        return (
          <div key={it.id} className={`ah-mnav-sheet-pill${activeTab === it.id ? ' is-active' : ''}`}>
            <button type="button" className="ah-mnav-sheet-tab" onClick={() => activate(it.id)}>
              {it.label}
            </button>
            <button
              type="button"
              className="ah-mnav-sheet-tab-x"
              aria-label="Đóng tab"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                closeInboundDetailTabByOrderId?.(it.detailCloseOrderId)
                closeSheet()
              }}
            >
              ×
            </button>
          </div>
        )
      }
      if (it.posDetailCloseOrderId) {
        return (
          <div key={it.id} className={`ah-mnav-sheet-pill${activeTab === it.id ? ' is-active' : ''}`}>
            <button type="button" className="ah-mnav-sheet-tab" onClick={() => activate(it.id)}>
              {it.label}
            </button>
            <button
              type="button"
              className="ah-mnav-sheet-tab-x"
              aria-label="Đóng tab"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                closePosDetailTabByOrderId?.(it.posDetailCloseOrderId)
                closeSheet()
              }}
            >
              ×
            </button>
          </div>
        )
      }
      if (it.posReturnDetailCloseLedgerId) {
        return (
          <div key={it.id} className={`ah-mnav-sheet-pill${activeTab === it.id ? ' is-active' : ''}`}>
            <button type="button" className="ah-mnav-sheet-tab" onClick={() => activate(it.id)}>
              {it.label}
            </button>
            <button
              type="button"
              className="ah-mnav-sheet-tab-x"
              aria-label="Đóng tab"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                closePosReturnDetailTabByLedgerId?.(it.posReturnDetailCloseLedgerId)
                closeSheet()
              }}
            >
              ×
            </button>
          </div>
        )
      }
      return (
        <button
          key={it.id}
          type="button"
          className={`ah-mnav-sheet-tab ah-mnav-sheet-tab--plain${activeTab === it.id ? ' is-active' : ''}`}
          onClick={() => activate(it.id)}
        >
          {it.label}
        </button>
      )
    },
    [
      activeTab,
      activate,
      closeSoloProductTabByVariantId,
      closeInboundDetailTabByOrderId,
      closePosDetailTabByOrderId,
      closePosReturnDetailTabByLedgerId,
      closeSheet,
    ]
  )

  return (
    <>
      <button
        type="button"
        className="ah-mnav-burger"
        aria-expanded={sheetOpen}
        aria-controls="ah-mnav-sheet"
        aria-label="Mở menu điều hướng"
        onClick={() => setSheetOpen((o) => !o)}
      >
        <span className="ah-mnav-burger-lines" aria-hidden />
      </button>

      {sheetOpen ? (
        <div
          className="ah-mnav-sheet-backdrop"
          role="presentation"
          aria-hidden={!sheetOpen}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSheet()
          }}
        >
          <div
            id="ah-mnav-sheet"
            className="ah-mnav-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu quản trị"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ah-mnav-sheet-head">
              <span className="ah-mnav-sheet-title">Chọn mục</span>
              <button type="button" className="ah-mnav-sheet-close" aria-label="Đóng" onClick={closeSheet}>
                ×
              </button>
            </div>
            <div className="ah-mnav-sheet-scroll">{adminHubNavTabs.map((it) => renderTabButton(it))}</div>
          </div>
        </div>
      ) : null}

      <nav className="ah-mnav-dock" aria-label="Điều hướng nhanh">
        {dockTabIds.map((tid) => {
          const meta = adminHubNavTabs.find((t) => t.id === tid)
          if (!meta) return null
          const short =
            tid === 'overview'
              ? 'DT'
              : tid === 'goods'
                ? 'HH'
                : tid === 'inbound'
                  ? 'NH'
                  : tid === 'orders'
                    ? 'ĐH'
                    : meta.label.slice(0, 2)
          return (
            <button
              key={tid}
              type="button"
              className={`ah-mnav-dock-btn${activeTab === tid ? ' is-active' : ''}`}
              onClick={() => activate(tid)}
              title={meta.label}
            >
              <span className="ah-mnav-dock-short">{short}</span>
              <span className="ah-mnav-dock-label">{meta.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={`ah-mnav-dock-btn ah-mnav-dock-btn--more${sheetOpen ? ' is-active' : ''}`}
          onClick={() => setSheetOpen(true)}
          title="Tất cả mục"
        >
          <span className="ah-mnav-dock-short">+</span>
          <span className="ah-mnav-dock-label">Menu</span>
        </button>
      </nav>
    </>
  )
})

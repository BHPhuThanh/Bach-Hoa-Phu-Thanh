/**
 * Modal danh sách sản phẩm tồn kho chạm đáy (từ thông báo digest).
 */
export default function LowStockReportModal({
  open,
  message = '',
  items = [],
  onClose,
  onGoInbound,
}) {
  if (!open) return null

  const hasItems = Array.isArray(items) && items.length > 0
  const bodyText = String(message ?? '').trim()

  return (
    <div
      className="app-low-stock-detail-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="app-low-stock-detail-modal app-low-stock-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-low-stock-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="app-low-stock-detail-head">
          <h2 id="app-low-stock-report-title" className="app-low-stock-detail-title">
            📋 Danh sách sản phẩm cần nhập hàng
          </h2>
          <button type="button" className="app-low-stock-detail-close" aria-label="Đóng" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="app-low-stock-detail-body">
          {bodyText ? (
            <div className="app-low-stock-report-message">{bodyText}</div>
          ) : hasItems ? (
            <ul className="app-low-stock-detail-list">
              {items.map((it) => (
                <li key={`${it.code}-${it.variant?.id ?? ''}`} className="app-low-stock-detail-item">
                  <span className="app-low-stock-detail-code">[{it.code}]</span>{' '}
                  <span className="app-low-stock-detail-name">{it.name}</span>
                  {it.stockLabel ? (
                    <span className="app-low-stock-detail-stock">Còn: {it.stockLabel}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-low-stock-detail-empty">Không có sản phẩm tồn thấp trong danh mục hiện tại.</p>
          )}
        </div>
        <footer className="app-low-stock-detail-foot">
          <button type="button" className="app-low-stock-detail-btn app-low-stock-detail-btn--ghost" onClick={onClose}>
            Đóng
          </button>
          <button
            type="button"
            className="app-low-stock-detail-btn app-low-stock-detail-btn--primary"
            disabled={!hasItems}
            onClick={onGoInbound}
          >
            Đến Tab Nhập Hàng
          </button>
        </footer>
      </div>
    </div>
  )
}

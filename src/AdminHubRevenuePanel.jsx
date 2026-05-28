import { buildAdminOrdersDetailAbsUrl } from './adminHubDeepLink.js'
import { orderTotalProfit } from './reportUtils.js'

function safeMoney(n) {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x) : 0
}

const VND_FMT = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

function formatVndSafe(n) {
  return VND_FMT.format(safeMoney(n))
}

/** Lợi nhuận dòng trả: luôn có dấu '-' ASCII khi âm (kèm nền đỏ ở class CSS). */
function formatVndProfitReturn(n) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return '0 đ'
  const abs = Math.abs(x)
  const body = `${abs.toLocaleString('vi-VN')} đ`
  if (x < 0) return `-${body}`
  if (x === 0) return '0 đ'
  return body
}

function RevenueOrderDetailLink({ orderId }) {
  const oid = String(orderId ?? '').trim()
  const href = oid ? buildAdminOrdersDetailAbsUrl(oid) : ''
  if (!href) return <span className="ah-revenue-order-detail-dash">—</span>
  return (
    <a
      href={href}
      className="ah-revenue-order-detail-link"
      target="_blank"
      rel="noopener noreferrer"
      title="Xem chi tiết đơn trong tab mới"
      onClick={(e) => e.stopPropagation()}
    >
      Xem chi tiết
    </a>
  )
}

function RevenueTableRows({
  rows,
  selected,
  setSelected,
  onOpenPosReturnDetail,
  revenueReadOnly,
  onDeleteOrder,
  deletingOrderId,
}) {
  try {
    return rows.map((row) => {
      if (row.kind === 'sale') {
        const o = row.order
        let profit = 0
        try {
          profit = orderTotalProfit(o)
        } catch {
          profit = 0
        }
        const active = selected && String(selected.id) === String(o.id)
        return (
          <tr
            key={`sale-${row.id}`}
            className={`ah-revenue-row ah-responsive-table-card-row${active ? ' is-active' : ''}`}
            onClick={() => setSelected(o)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setSelected(o)
              }
            }}
            role="button"
            tabIndex={0}
            title="Xem chi tiết đơn"
          >
            <td className="ah-revenue-cell-code" data-label="Mã đơn">
              {o.invoiceNo || '—'}
            </td>
            <td className="ah-revenue-cell-time" data-label="Thời gian">
              {(() => {
                try {
                  return new Date(o.createdAt).toLocaleString('vi-VN')
                } catch {
                  return '—'
                }
              })()}
            </td>
            <td className="ah-num" data-label="Tổng tiền">
              {formatVndSafe(o.total)}
            </td>
            <td className="ah-num ah-revenue-profit" data-label="Lợi nhuận">
              {formatVndSafe(profit)}
            </td>
            <td className="ah-revenue-cell-detail" data-label="Chi tiết" onClick={(e) => e.stopPropagation()}>
              <RevenueOrderDetailLink orderId={o.id} />
            </td>
            <td className="ah-revenue-cell-actions" data-label="Thao tác" onClick={(e) => e.stopPropagation()}>
              {!revenueReadOnly ? (
                <button
                  type="button"
                  className="ah-revenue-delete-btn"
                  onClick={() => onDeleteOrder?.(o)}
                  disabled={String(deletingOrderId || '') === String(o.id || '')}
                  title="Xóa vĩnh viễn đơn hàng"
                  aria-label={`Xóa đơn ${o.invoiceNo || o.id || ''}`}
                >
                  {String(deletingOrderId || '') === String(o.id || '') ? 'Đang xóa...' : '🗑 Xóa đơn'}
                </button>
              ) : (
                <span className="ah-revenue-order-detail-dash">—</span>
              )}
            </td>
          </tr>
        )
      }

      const r = row.returnRow
      const canOpen =
        typeof onOpenPosReturnDetail === 'function' && Boolean(String(r.ledgerId ?? '').trim())
      return (
        <tr
          key={`ret-${row.id}`}
          className="ah-revenue-row ah-revenue-row--return ah-responsive-table-card-row"
          title={canOpen ? 'Xem chi tiết hoàn trả' : 'Giao dịch hoàn trả'}
        >
          <td className="ah-revenue-cell-code ah-revenue-cell-code--return" data-label="Mã đơn">
            {canOpen ? (
              <button
                type="button"
                className="ah-revenue-return-code-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenPosReturnDetail(String(r.ledgerId))
                }}
              >
                {r.invoiceNo || '—'}
              </button>
            ) : (
              (r.invoiceNo || '—')
            )}
          </td>
          <td className="ah-revenue-cell-time" data-label="Thời gian">
            {(() => {
              try {
                return new Date(r.createdAt).toLocaleString('vi-VN')
              } catch {
                return '—'
              }
            })()}
          </td>
          <td className="ah-num ah-revenue-total--return" data-label="Tổng tiền">
            {formatVndSafe(r.displayTotal)}
          </td>
          <td className="ah-num ah-revenue-profit ah-revenue-profit--return" data-label="Lợi nhuận">
            {formatVndProfitReturn(r.displayProfit)}
          </td>
          <td className="ah-revenue-cell-detail" data-label="Chi tiết" onClick={(e) => e.stopPropagation()}>
            <RevenueOrderDetailLink orderId={r.sourceOrderId} />
          </td>
          <td className="ah-revenue-cell-actions" data-label="Thao tác">
            <span className="ah-revenue-order-detail-dash">—</span>
          </td>
        </tr>
      )
    })
  } catch (e) {
    console.error('[AdminHubRevenuePanel] rows', e)
    return (
      <tr className="ah-responsive-table-empty">
        <td colSpan={6} className="dash-muted ah-revenue-empty">
          Không hiển thị được danh sách đơn (dữ liệu lỗi). Các chỉ số phía trên vẫn có thể dùng được.
        </td>
      </tr>
    )
  }
}

/**
 * Tab Doanh thu — không import logic Nhập hàng; chỉ nhận dữ liệu đã tính từ cha.
 */
export default function AdminHubRevenuePanel({
  revenueReadOnly,
  orders,
  loading,
  ovRange,
  setOvRange,
  ovFrom,
  ovTo,
  setOvFrom,
  setOvTo,
  showCustomDateRange,
  ovFiltered,
  ovRevenueTableRows,
  ovStats,
  selected,
  setSelected,
  rangePresets,
  rangeLabels,
  onExport,
  onClearAll,
  onOpenPosReturnDetail,
  onDeleteOrder,
  deletingOrderId,
}) {
  let revenue = 0
  let cost = 0
  let profit = 0
  try {
    revenue = safeMoney(ovStats?.revenue)
    cost = safeMoney(ovStats?.cost)
    profit = safeMoney(ovStats?.profit)
  } catch {
    /* noop */
  }

  const rowsSafe = Array.isArray(ovRevenueTableRows) ? ovRevenueTableRows : []
  const returnRowCount = rowsSafe.filter((r) => r.kind === 'return').length
  const hasTableRows = rowsSafe.length > 0
  const noSavedOrders = !loading && orders.length === 0
  const noDataInRange = !loading && orders.length > 0 && !hasTableRows

  return (
    <div className="ah-revenue-page dash">
      <header className="ah-revenue-header">
        <h2 className="admin-hub-panel-title ah-revenue-title" id="ah-revenue-title">
          Doanh thu
        </h2>
        {revenueReadOnly && (
          <div className="ah-doanh-thu-readonly-banner" role="status">
            Bạn đang xem với quyền <strong>Nhân viên</strong> — báo cáo vẫn hiển thị (0 đ nếu chưa có đơn). Xuất
            Excel và xóa toàn bộ lịch sử chỉ dùng được khi đăng nhập <strong>Admin</strong> trên màn Bán hàng rồi
            mở lại trang này.
          </div>
        )}
        <p className="admin-hub-muted ah-revenue-lead">
          Báo cáo theo khoảng thời gian — đơn lưu cục bộ. <strong>Tiền vốn</strong> trên mỗi dòng bán = cột{' '}
          <strong>Giá vốn</strong> của mặt hàng trong danh mục (file KiotViet / CSV import) tại thời điểm thanh
          toán, nhân số lượng — đối chiếu được với file danh mục đã nạp. Các dòng mã <strong>TH-…</strong> là hoàn
          trả trong khoảng thời gian (đã trừ vào tổng phía trên).
        </p>
        <div className="dash-toolbar ah-revenue-toolbar">
          <button type="button" className="btn-dash btn-dash-primary" onClick={onExport} disabled={revenueReadOnly}>
            Xuất báo cáo Excel
          </button>
          <button
            type="button"
            className="btn-dash btn-dash-danger"
            onClick={onClearAll}
            disabled={orders.length === 0 || revenueReadOnly}
          >
            Xóa toàn bộ lịch sử
          </button>
          {!loading && (orders.length > 0 || returnRowCount > 0) && (
            <span className="dash-toolbar-meta">
              Hiển thị: {rowsSafe.length} dòng
              {returnRowCount > 0 ? ` (${ovFiltered.length} đơn bán + ${returnRowCount} trả hàng)` : ''}
              {orders.length > 0 ? ` · ${orders.length} đơn đã lưu` : ''}
            </span>
          )}
        </div>

        <div className="admin-hub-chip-row ah-revenue-chips" role="group" aria-label="Khoảng thời gian">
          {rangePresets.map((k) => (
            <button
              key={k}
              type="button"
              className={`admin-hub-chip${ovRange === k ? ' is-active' : ''}`}
              onClick={() => setOvRange(k)}
            >
              {rangeLabels[k]}
            </button>
          ))}
        </div>
        {showCustomDateRange && (
          <div className="admin-hub-date-row ah-revenue-date-row">
            <label>
              Từ
              <input
                type="date"
                className="admin-hub-date-input"
                value={ovFrom}
                onChange={(e) => setOvFrom(e.target.value)}
              />
            </label>
            <label>
              Đến
              <input
                type="date"
                className="admin-hub-date-input"
                value={ovTo}
                onChange={(e) => setOvTo(e.target.value)}
              />
            </label>
          </div>
        )}
      </header>

      <section className="ah-revenue-kpis" aria-label="Chỉ số tổng quan">
        <article className="ah-revenue-card ah-revenue-card--revenue">
          <span className="ah-revenue-card__label">Doanh thu</span>
          <strong className="ah-revenue-card__value">{formatVndSafe(revenue)}</strong>
          <span className="ah-revenue-card__hint">Đơn bán trong khoảng trừ hoàn trả ghi nhận cùng khoảng</span>
        </article>
        <article className="ah-revenue-card ah-revenue-card--cost">
          <span className="ah-revenue-card__label">Tiền vốn</span>
          <strong className="ah-revenue-card__value">{formatVndSafe(cost)}</strong>
          <span className="ah-revenue-card__hint">
            Tổng (Giá vốn KiotViet/CSV × SL) theo từng dòng đơn lúc thanh toán, đã trừ vốn hoàn trả
          </span>
        </article>
        <article className="ah-revenue-card ah-revenue-card--profit">
          <span className="ah-revenue-card__label">Lợi nhuận</span>
          <strong className="ah-revenue-card__value ah-revenue-card__value--profit">
            {formatVndSafe(profit)}
          </strong>
          <span className="ah-revenue-card__hint">Doanh thu − Tiền vốn (đã gồm tác động hoàn trả)</span>
        </article>
      </section>
      {loading && (
        <p className="dash-muted ah-revenue-loading" aria-live="polite">
          Đang tải dữ liệu đơn… Các ô trên hiển thị 0 đ cho đến khi tải xong.
        </p>
      )}

      <section className="ah-revenue-detail" aria-labelledby="ah-revenue-detail-title">
        <h3 className="ah-revenue-detail-title" id="ah-revenue-detail-title">
          Danh sách đơn
        </h3>
        {loading ? (
          <p className="dash-muted">Đang tải…</p>
        ) : noSavedOrders && returnRowCount === 0 ? (
          <p className="dash-muted ah-revenue-empty">
            Chưa có đơn thanh toán nào. Thanh toán ở màn <strong>Bán hàng</strong> để dữ liệu xuất hiện tại đây.
          </p>
        ) : noDataInRange ? (
          <p className="dash-muted ah-revenue-empty">Chưa có dữ liệu doanh thu trong khoảng thời gian này.</p>
        ) : (
          <div className="admin-hub-table-wrap ah-revenue-table-wrap ah-responsive-table-wrap">
            <table className="admin-hub-table ah-revenue-table ah-responsive-table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Thời gian</th>
                  <th className="ah-num">Tổng tiền</th>
                  <th className="ah-num">Lợi nhuận</th>
                  <th className="ah-revenue-th-detail">Chi tiết</th>
                  <th className="ah-revenue-th-actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                <RevenueTableRows
                  rows={rowsSafe}
                  selected={selected}
                  setSelected={setSelected}
                  onOpenPosReturnDetail={onOpenPosReturnDetail}
                  revenueReadOnly={revenueReadOnly}
                  onDeleteOrder={onDeleteOrder}
                  deletingOrderId={deletingOrderId}
                />
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getStockCheckCreateAbsUrl } from './sellerRoleStorage.js'

/** URL mở tab mới: `origin` + BASE_URL + `/hang-hoa/` + mã hàng (encode). */
function buildStockCheckHangHoaProductUrl(maHang) {
  const m = String(maHang ?? '').trim()
  if (!m) return ''
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return `${window.location.origin}${base}/admin/goods?search=${encodeURIComponent(m)}`
}

function formatDateTimeVi(ms) {
  if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return '—'
  return new Date(Number(ms)).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function qtyLabel(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('vi-VN')
}

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** @returns {[number, number] | null} */
function getCreatedDateRange(preset, customFromYmd, customToYmd) {
  const now = new Date()
  if (preset === 'all') return null
  if (preset === 'today') {
    const a = new Date(now)
    a.setHours(0, 0, 0, 0)
    const b = new Date(now)
    b.setHours(23, 59, 59, 999)
    return [a.getTime(), b.getTime()]
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const a = new Date(y)
    a.setHours(0, 0, 0, 0)
    const b = new Date(y)
    b.setHours(23, 59, 59, 999)
    return [a.getTime(), b.getTime()]
  }
  if (preset === 'this_month') {
    const a = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    const b = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return [a.getTime(), b.getTime()]
  }
  if (preset === 'custom' && customFromYmd && customToYmd) {
    const a = new Date(`${customFromYmd}T00:00:00`)
    const b = new Date(`${customToYmd}T23:59:59.999`)
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null
    return [a.getTime(), b.getTime()]
  }
  return null
}

/** @param {{ vouchers: unknown[] }} props */
export default function AdminHubStockCheckPanel({ vouchers }) {
  const [expandedCode, setExpandedCode] = useState(null)
  const [searchQ, setSearchQ] = useState('')
  /** @type {'all'|'hoan_thanh'|'da_huy'} */
  const [statusFilter, setStatusFilter] = useState('all')
  /** @type {'all'|'today'|'yesterday'|'this_month'|'custom'} */
  const [datePreset, setDatePreset] = useState('all')
  const [customFromYmd, setCustomFromYmd] = useState(todayYmd)
  const [customToYmd, setCustomToYmd] = useState(todayYmd)

  const [openStatusMenu, setOpenStatusMenu] = useState(false)
  const [openDateMenu, setOpenDateMenu] = useState(false)

  const statusWrapRef = useRef(null)
  const dateWrapRef = useRef(null)

  const openCreateStockCheckPage = useCallback(() => {
    const url = getStockCheckCreateAbsUrl()
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  useEffect(() => {
    const onDoc = (e) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (statusWrapRef.current?.contains(t)) return
      if (dateWrapRef.current?.contains(t)) return
      setOpenStatusMenu(false)
      setOpenDateMenu(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const sorted = useMemo(() => {
    const v = Array.isArray(vouchers) ? [...vouchers] : []
    v.sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))
    return v
  }, [vouchers])

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    const range = getCreatedDateRange(datePreset, customFromYmd, customToYmd)
    return sorted.filter((row) => {
      if (q && !String(row.code ?? '').toLowerCase().includes(q)) return false
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (range) {
        const t = Number(row.createdAtMs) || 0
        if (t < range[0] || t > range[1]) return false
      }
      return true
    })
  }, [sorted, searchQ, statusFilter, datePreset, customFromYmd, customToYmd])

  const statusLabel =
    statusFilter === 'all'
      ? 'Trạng thái'
      : statusFilter === 'hoan_thanh'
        ? 'Hoàn thành'
        : 'Đã hủy'

  const dateLabelMap = {
    all: 'Ngày tạo',
    today: 'Hôm nay',
    yesterday: 'Hôm qua',
    this_month: 'Tháng này',
    custom: 'Lựa chọn ngày',
  }

  const toggleExpand = useCallback((code) => {
    setExpandedCode((cur) => (cur === code ? null : code))
  }, [])

  const closeExpandedDetail = useCallback(() => {
    setExpandedCode(null)
  }, [])

  const openProductNewTab = useCallback((e, maHang) => {
    e.preventDefault()
    const url = buildStockCheckHangHoaProductUrl(maHang)
    if (!url) return
    console.log('LINK REDIRECT ĐẾN:', url)
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const pickStatus = useCallback((v) => {
    setStatusFilter(v)
    setOpenStatusMenu(false)
  }, [])

  const pickDatePreset = useCallback((v) => {
    setDatePreset(v)
    if (v !== 'custom') setOpenDateMenu(false)
    if (v === 'custom') {
      const t = todayYmd()
      setCustomFromYmd((x) => x || t)
      setCustomToYmd((x) => x || t)
    }
  }, [])

  return (
    <section className="ah-stock-check" aria-labelledby="ah-stock-check-title">
      <div className="ah-stock-check-toolbar-row">
        <h2 id="ah-stock-check-title" className="ah-stock-check-inline-title">
          Kiểm hàng
        </h2>
        <div className="ah-stock-check-toolbar-search-wrap">
          <svg
            className="ah-stock-check-toolbar-search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            className="ah-stock-check-toolbar-search"
            placeholder="Tìm kiếm theo mã phiếu kiểm hàng"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Tìm kiếm theo mã phiếu kiểm hàng"
          />
        </div>

        <div className="ah-stock-check-dd" ref={statusWrapRef}>
          <button
            type="button"
            className="ah-stock-check-dd-trigger"
            aria-expanded={openStatusMenu}
            aria-haspopup="listbox"
            onClick={() => {
              setOpenStatusMenu((o) => !o)
              setOpenDateMenu(false)
            }}
          >
            <span className="ah-stock-check-dd-label">{statusLabel}</span>
            <span className="ah-stock-check-dd-chev" aria-hidden>
              ▾
            </span>
          </button>
          {openStatusMenu ? (
            <div className="ah-stock-check-dd-menu" role="listbox">
              <button type="button" role="option" className="" onClick={() => pickStatus('all')}>
                Tất cả
              </button>
              <button
                type="button"
                role="option"
                className="ah-stock-check-dd-opt ah-stock-check-dd-opt--ok"
                onClick={() => pickStatus('hoan_thanh')}
              >
                Hoàn thành
              </button>
              <button
                type="button"
                role="option"
                className="ah-stock-check-dd-opt ah-stock-check-dd-opt--cancel"
                onClick={() => pickStatus('da_huy')}
              >
                Đã hủy
              </button>
            </div>
          ) : null}
        </div>

        <div className="ah-stock-check-dd" ref={dateWrapRef}>
          <button
            type="button"
            className="ah-stock-check-dd-trigger"
            aria-expanded={openDateMenu}
            aria-haspopup="listbox"
            onClick={() => {
              setOpenDateMenu((o) => !o)
              setOpenStatusMenu(false)
            }}
          >
            <span className="ah-stock-check-dd-label">{dateLabelMap[datePreset]}</span>
            <span className="ah-stock-check-dd-chev" aria-hidden>
              ▾
            </span>
          </button>
          {openDateMenu ? (
            <div className="ah-stock-check-dd-menu ah-stock-check-dd-menu--wide" role="listbox">
              <button type="button" role="option" onClick={() => pickDatePreset('all')}>
                Tất cả
              </button>
              <button type="button" role="option" onClick={() => pickDatePreset('today')}>
                Hôm nay
              </button>
              <button type="button" role="option" onClick={() => pickDatePreset('yesterday')}>
                Hôm qua
              </button>
              <button type="button" role="option" onClick={() => pickDatePreset('this_month')}>
                Tháng này
              </button>
              <div className="ah-stock-check-dd-divider" />
              <button
                type="button"
                role="option"
                className={datePreset === 'custom' ? 'is-active' : ''}
                onClick={() => pickDatePreset('custom')}
              >
                Lựa chọn ngày
              </button>
              {datePreset === 'custom' ? (
                <div className="ah-stock-check-date-custom" onClick={(e) => e.stopPropagation()}>
                  <label className="ah-stock-check-date-lbl">
                    Từ
                    <input
                      type="date"
                      className="ah-stock-check-date-input"
                      value={customFromYmd}
                      onChange={(e) => setCustomFromYmd(e.target.value)}
                    />
                  </label>
                  <label className="ah-stock-check-date-lbl">
                    Đến
                    <input
                      type="date"
                      className="ah-stock-check-date-input"
                      value={customToYmd}
                      onChange={(e) => setCustomToYmd(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="ah-stock-check-date-apply"
                    onClick={() => setOpenDateMenu(false)}
                  >
                    Áp dụng
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button type="button" className="ah-stock-check-btn-create" onClick={openCreateStockCheckPage}>
          + Tạo phiếu kiểm
        </button>
      </div>

      <p className="admin-hub-muted ah-stock-check-hint">
        Dùng <strong>+ Tạo phiếu kiểm</strong> để mở màn nhập kiểm kê trên tab mới. Phiếu <strong>Hoàn thành</strong> cũng
        được tạo tự động khi bạn lưu thay đổi <strong>Tồn kho</strong> trên tab <strong>Hàng hóa</strong>.
      </p>

      <div className="admin-hub-table-wrap ah-stock-check-table-wrap">
        <table className="admin-hub-table ah-stock-check-table ah-hub-voucher-table">
          <thead>
            <tr>
              <th>Mã phiếu kiểm</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
              <th>Ngày cân bằng</th>
              <th>Nhân viên tạo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="ah-stock-check-empty">
                  {sorted.length === 0 ? 'Chưa có phiếu kiểm.' : 'Không có phiếu khớp bộ lọc.'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const open = expandedCode === row.code
                const done = row.status === 'hoan_thanh'
                return (
                  <Fragment key={row.code}>
                    <tr
                      className={`ah-hub-voucher-summary-row${open ? ' ah-stock-check-row--open' : ''}`}
                    >
                      <td data-label="Mã phiếu kiểm">
                        <button
                          type="button"
                          className="ah-stock-check-code-btn"
                          onClick={() => toggleExpand(row.code)}
                          aria-expanded={open}
                        >
                          {row.code}
                        </button>
                      </td>
                      <td data-label="Trạng thái">
                        {done ? (
                          <span className="ah-stock-check-badge ah-stock-check-badge--ok">Hoàn thành</span>
                        ) : (
                          <span className="ah-stock-check-badge ah-stock-check-badge--cancel">Đã hủy</span>
                        )}
                      </td>
                      <td data-label="Ngày tạo">{formatDateTimeVi(row.createdAtMs)}</td>
                      <td data-label="Ngày cân bằng">{formatDateTimeVi(row.balancedAtMs)}</td>
                      <td data-label="Nhân viên tạo">{row.createdBy || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="ah-stock-check-detail-row">
                        <td colSpan={5}>
                          <div className="ah-stock-check-detail-inner">
                            <div className="ah-stock-check-detail-body">
                              <div
                                className="ah-stock-check-detail-meta ah-stock-check-detail-meta--grid"
                                aria-label="Thông tin phiếu"
                              >
                                <div className="ah-stock-check-detail-meta-cell">
                                  <span className="ah-stock-check-detail-meta-lbl">Mã phiếu</span>
                                  <span className="ah-stock-check-detail-meta-val">{row.code}</span>
                                </div>
                                <div className="ah-stock-check-detail-meta-cell">
                                  <span className="ah-stock-check-detail-meta-lbl">Trạng thái</span>
                                  <span className="ah-stock-check-detail-meta-val">
                                    {done ? 'Hoàn thành' : 'Đã hủy'}
                                  </span>
                                </div>
                                <div className="ah-stock-check-detail-meta-cell">
                                  <span className="ah-stock-check-detail-meta-lbl">Ngày tạo</span>
                                  <span className="ah-stock-check-detail-meta-val">
                                    {formatDateTimeVi(row.createdAtMs)}
                                  </span>
                                </div>
                                <div className="ah-stock-check-detail-meta-cell">
                                  <span className="ah-stock-check-detail-meta-lbl">Ngày cân bằng</span>
                                  <span className="ah-stock-check-detail-meta-val">
                                    {formatDateTimeVi(row.balancedAtMs)}
                                  </span>
                                </div>
                                <div className="ah-stock-check-detail-meta-cell">
                                  <span className="ah-stock-check-detail-meta-lbl">Nhân viên tạo</span>
                                  <span className="ah-stock-check-detail-meta-val">{row.createdBy || '—'}</span>
                                </div>
                              </div>
                              <div className="ah-stock-check-detail-tabs" aria-hidden>
                                <span className="ah-stock-check-detail-tab is-active">Tất cả</span>
                              </div>
                              {row.lines?.length ? (
                                <div className="admin-hub-table-wrap ah-stock-check-subtable-wrap">
                                  <table
                                    className="admin-hub-table ah-stock-check-subtable ah-stock-check-subtable--stock ah-hub-voucher-line-table"
                                  >
                                    <colgroup>
                                      <col className="ah-stock-col-stt" />
                                      <col className="ah-stock-col-img" />
                                      <col className="ah-stock-col-name" />
                                      <col className="ah-stock-col-unit" />
                                      <col className="ah-stock-col-br" />
                                      <col className="ah-stock-col-act" />
                                      <col className="ah-stock-col-delta" />
                                      <col className="ah-stock-col-reason" />
                                      <col className="ah-stock-col-note" />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th>STT</th>
                                        <th>Ảnh</th>
                                        <th>Tên sản phẩm</th>
                                        <th>Đơn vị</th>
                                        <th>Tồn chi nhánh</th>
                                        <th>Tồn thực tế</th>
                                        <th>Số lượng lệch</th>
                                        <th>Lý do</th>
                                        <th>Ghi chú</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.lines.map((ln, i) => (
                                        <tr
                                          key={`${row.code}-${ln.variantId}-${i}`}
                                          className="ah-hub-voucher-line-card"
                                        >
                                          <td data-label="STT" className="ah-voucher-line-hide-mobile">
                                            {i + 1}
                                          </td>
                                          <td className="ah-voucher-line-hide-mobile">
                                            <span className="ah-stock-check-ph-img" aria-hidden />
                                          </td>
                                          <td data-label="Tên sản phẩm">
                                            <div className="ah-stock-check-name-cell">
                                              <a
                                                href={
                                                  buildStockCheckHangHoaProductUrl(
                                                    String(ln.productCode ?? '').trim() ||
                                                      String(ln.variantId ?? '')
                                                  ) || '#'
                                                }
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="ah-stock-check-name-link"
                                                onClick={(e) =>
                                                  openProductNewTab(
                                                    e,
                                                    String(ln.productCode ?? '').trim() ||
                                                      String(ln.variantId ?? '')
                                                  )
                                                }
                                              >
                                                {ln.productName || '—'}
                                              </a>
                                              <div className="ah-stock-check-code-sub">{ln.productCode || '—'}</div>
                                            </div>
                                          </td>
                                          <td data-label="Đơn vị">{ln.unitLabel || '—'}</td>
                                          <td data-label="Tồn chi nhánh" className="ah-num">
                                            {qtyLabel(ln.branchQty)}
                                          </td>
                                          <td data-label="Tồn thực tế" className="ah-num">
                                            {qtyLabel(ln.actualQty)}
                                          </td>
                                          <td data-label="Số lượng lệch" className="ah-num">
                                            {qtyLabel(ln.deltaQty)}
                                          </td>
                                          <td data-label="Lý do">{ln.reason || '—'}</td>
                                          <td data-label="Ghi chú">{ln.note || ''}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {/* CARD LAYOUT — chỉ hiện trên Mobile (<=768px) */}
                                  <div className="ah-voucher-cards">
                                    {row.lines.map((ln, i) => {
                                      const d = Number(ln.deltaQty)
                                      const deltaCls =
                                        !Number.isFinite(d) || d === 0
                                          ? 'ah-voucher-card__delta--zero'
                                          : d > 0
                                            ? 'ah-voucher-card__delta--pos'
                                            : 'ah-voucher-card__delta--neg'
                                      return (
                                        <div
                                          className="ah-voucher-card"
                                          key={`card-${row.code}-${ln.variantId}-${i}`}
                                        >
                                          <div className="ah-voucher-card__title">{ln.productName || '—'}</div>
                                          <div className="ah-voucher-card__sub">
                                            {ln.productCode || '—'} · {ln.unitLabel || '—'}
                                          </div>
                                          <div className="ah-voucher-card__stats ah-voucher-card__stats--3">
                                            <div className="ah-voucher-card__stat">
                                              <span className="ah-voucher-card__stat-lbl">Hệ thống</span>
                                              <span className="ah-voucher-card__stat-val">{qtyLabel(ln.branchQty)}</span>
                                            </div>
                                            <div className="ah-voucher-card__stat">
                                              <span className="ah-voucher-card__stat-lbl">Thực tế</span>
                                              <span className="ah-voucher-card__stat-val">{qtyLabel(ln.actualQty)}</span>
                                            </div>
                                            <div className="ah-voucher-card__stat ah-voucher-card__stat--right">
                                              <span className="ah-voucher-card__stat-lbl">Lệch</span>
                                              <span className={`ah-voucher-card__stat-val ${deltaCls}`}>
                                                {qtyLabel(ln.deltaQty)}
                                              </span>
                                            </div>
                                          </div>
                                          {ln.reason && ln.reason !== '—' ? (
                                            <div className="ah-voucher-card__note">Lý do: {ln.reason}</div>
                                          ) : null}
                                          {ln.note ? (
                                            <div className="ah-voucher-card__note">Ghi chú: {ln.note}</div>
                                          ) : null}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="ah-stock-check-no-lines">Phiếu không có dòng sản phẩm.</p>
                              )}
                            </div>
                            <div className="ah-stock-check-detail-close-wrap">
                              <button
                                type="button"
                                className="ah-stock-check-detail-close-btn"
                                onClick={closeExpandedDetail}
                                aria-label="Đóng chi tiết phiếu kiểm"
                              >
                                <svg
                                  className="ah-stock-check-detail-close-icon"
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  aria-hidden
                                >
                                  <path
                                    d="M18 6L6 18M6 6l12 12"
                                    stroke="currentColor"
                                    strokeWidth="2.25"
                                    strokeLinecap="round"
                                  />
                                </svg>
                                <span className="ah-stock-check-detail-close-label">Đóng</span>
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

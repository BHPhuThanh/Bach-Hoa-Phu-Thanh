import { getComboBom } from './comboCatalog.js'
import { shouldShowComboBomTab } from './comboBomTabVisible.js'
import { buildOpenHangHoaGoodsAbsUrl } from './adminHubDeepLink.js'
import { findVariantContext } from './inboundFormUnitHelpers.js'

function formatVnRoundMoney(n) {
  const x = Math.round(Number(n) || 0)
  return `${x.toLocaleString('vi-VN')} đ`
}

function formatVnQty(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  if (Math.abs(x - Math.round(x)) < 1e-9) return Math.round(x).toLocaleString('vi-VN')
  return x.toLocaleString('vi-VN')
}

function resolveBomLineDisplay(catalogList, row) {
  const ctx = findVariantContext(catalogList || [], row.variantId)
  const vv = ctx?.clicked
  const code = String(vv?.code || row.codeSnap || '').trim() || '—'
  const name = String(vv?.name || row.nameSnap || '').trim() || '—'
  const cost = Math.round(Math.max(0, Number(vv?.cost) || 0))
  const price = Math.round(Math.max(0, Number(vv?.price) || 0))
  const qty = Math.max(0, Number(row.qty) || 0)
  const lineCost = Math.round(cost * qty)
  const lineRetail = Math.round(price * qty)
  const productUrl =
    code && code !== '—'
      ? buildOpenHangHoaGoodsAbsUrl(row.variantId, code)
      : buildOpenHangHoaGoodsAbsUrl(row.variantId, '')
  return { code, name, cost, price, qty, lineCost, lineRetail, productUrl }
}

/**
 * Tab «Thành phần combo» — bảng BOM + tổng vốn/bán lẻ (dark theme, cuộn ngang mobile).
 */
export function AdminHubComboBomPanel({
  catalogList,
  comboProduct,
  onEditComboProduct,
  className = '',
  leadText = 'Khi bán combo, tồn kho trừ theo từng thành phần (POS).',
}) {
  if (!comboProduct || !shouldShowComboBomTab(comboProduct)) return null

  const bom = getComboBom(comboProduct)
  const rows = bom.map((row, idx) => {
    const d = resolveBomLineDisplay(catalogList, row)
    return { key: `${row.variantId}-${idx}`, idx: idx + 1, ...d }
  })
  const sumCost = rows.reduce((s, r) => s + r.lineCost, 0)
  const sumRetail = rows.reduce((s, r) => s + r.lineRetail, 0)

  return (
    <div className={`ah-goods-combo-detail-wrap${className ? ` ${className}` : ''}`}>
      <div className="ah-goods-combo-detail-head">
        <span className="admin-hub-muted ah-goods-combo-detail-lead">{leadText}</span>
        {typeof onEditComboProduct === 'function' ? (
          <button
            type="button"
            className="ah-goods-combo-edit-btn"
            onClick={(e) => {
              e.stopPropagation()
              onEditComboProduct()
            }}
            title="Chỉnh sửa thành phần / giá combo"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                stroke="currentColor"
                strokeWidth="1.85"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Chỉnh sửa
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="admin-hub-muted ah-goods-combo-empty">Chưa có thành phần trong combo.</p>
      ) : (
        <>
          <div className="admin-hub-table-wrap ah-goods-combo-table-scroll ah-responsive-table-wrap">
            <table className="admin-hub-table ah-goods-combo-bom-table">
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Mã hàng hóa</th>
                  <th>Tên hàng hóa</th>
                  <th className="ah-num">Số lượng</th>
                  <th className="ah-num">Giá vốn</th>
                  <th className="ah-num">Giá bán lẻ</th>
                  <th className="ah-num">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="ah-responsive-table-card-row">
                    <td data-label="STT">{r.idx}</td>
                    <td data-label="Mã hàng hóa">
                      {r.productUrl ? (
                        <a
                          href={r.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ah-goods-combo-code-link"
                          title="Mở chi tiết sản phẩm (tab mới)"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.code}
                        </a>
                      ) : (
                        r.code
                      )}
                    </td>
                    <td data-label="Tên hàng hóa">{r.name}</td>
                    <td className="ah-num" data-label="Số lượng">
                      {formatVnQty(r.qty)}
                    </td>
                    <td className="ah-num" data-label="Giá vốn">
                      {formatVnRoundMoney(r.cost)}
                    </td>
                    <td className="ah-num" data-label="Giá bán lẻ">
                      {formatVnRoundMoney(r.price)}
                    </td>
                    <td className="ah-num" data-label="Thành tiền">
                      {formatVnRoundMoney(r.lineRetail)}
                    </td>
                  </tr>
                ))}
                <tr className="ah-goods-combo-bom-tfoot">
                  <td colSpan={3} className="ah-goods-combo-bom-tfoot-lbl">
                    Tổng tiền thành phần
                  </td>
                  <td />
                  <td className="ah-num ah-goods-combo-bom-tfoot-sum" data-label="Tổng giá vốn">
                    {formatVnRoundMoney(sumCost)}
                  </td>
                  <td className="ah-num ah-goods-combo-bom-tfoot-lbl-sub">Tổng bán lẻ</td>
                  <td className="ah-num ah-goods-combo-bom-tfoot-sum" data-label="Tổng thành tiền">
                    {formatVnRoundMoney(sumRetail)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul className="ah-goods-combo-mobile-cards" aria-label="Thành phần combo (mobile)">
            {rows.map((r) => (
              <li key={`m-${r.key}`} className="ah-goods-combo-mobile-card">
                <div className="ah-goods-combo-mobile-card__head">
                  <span className="ah-goods-combo-mobile-card__stt">#{r.idx}</span>
                  {r.productUrl ? (
                    <a
                      href={r.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ah-goods-combo-code-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.code}
                    </a>
                  ) : (
                    <span className="ah-muted-code">{r.code}</span>
                  )}
                </div>
                <div className="ah-goods-combo-mobile-card__name">{r.name}</div>
                <dl className="ah-goods-combo-mobile-card__grid">
                  <div>
                    <dt>Số lượng</dt>
                    <dd>{formatVnQty(r.qty)}</dd>
                  </div>
                  <div>
                    <dt>Giá vốn</dt>
                    <dd>{formatVnRoundMoney(r.cost)}</dd>
                  </div>
                  <div>
                    <dt>Giá bán lẻ</dt>
                    <dd>{formatVnRoundMoney(r.price)}</dd>
                  </div>
                  <div>
                    <dt>Thành tiền</dt>
                    <dd>{formatVnRoundMoney(r.lineRetail)}</dd>
                  </div>
                </dl>
              </li>
            ))}
            <li className="ah-goods-combo-mobile-card ah-goods-combo-mobile-card--total">
              <div className="ah-goods-combo-mobile-card__total-lbl">Tổng tiền thành phần</div>
              <dl className="ah-goods-combo-mobile-card__grid">
                <div>
                  <dt>Tổng giá vốn</dt>
                  <dd>{formatVnRoundMoney(sumCost)}</dd>
                </div>
                <div>
                  <dt>Tổng giá bán lẻ</dt>
                  <dd>{formatVnRoundMoney(sumRetail)}</dd>
                </div>
              </dl>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

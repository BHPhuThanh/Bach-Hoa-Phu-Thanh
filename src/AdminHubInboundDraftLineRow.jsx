import { memo, useCallback } from 'react'
import {
  applyInboundLineUnitChange,
  buildInboundDvtSelectOptions,
} from './inboundFormUnitHelpers.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'
import { buildOpenHangHoaGoodsAbsUrl } from './adminHubDeepLink.js'

function inboundLineTotal(line) {
  const gross = Math.max(0, Number(line.qty) || 0) * Math.max(0, Number(line.unitPrice) || 0)
  return Math.max(0, gross - Math.max(0, Number(line.lineDiscount) || 0))
}

function inboundLineThuongHieuResolved(line, catalogList) {
  const n = line
  if (n.thuong_hieu) return n.thuong_hieu
  const vid = String(n.variantId || '').trim()
  if (!vid || !catalogList?.length) return ''
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const v = flat.find((x) => String(x.id) === vid)
  return String(v?.brand ?? '').trim()
}

function formatMoneyDraftVi(n) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return ''
  return x.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function parseMoneyDraftVi(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

function inboundRowDomId(line) {
  const raw = String(line?.ma_hang || line?.code || line?.variantId || line?.lineId || '').trim()
  const safe = raw.replace(/[^\w.-]/g, '_') || 'row'
  return `inbound-row-${safe}`
}

function propsEqual(a, b) {
  if (a === b) return true
  if (a.ln !== b.ln || a.idx !== b.idx || a.catalogListForInbound !== b.catalogListForInbound) return false
  if (
    a.removeInboundFormLine !== b.removeInboundFormLine ||
    a.updateInboundFormLine !== b.updateInboundFormLine ||
    a.selectInboundInputOnFocus !== b.selectInboundInputOnFocus ||
    a.handleInboundNumericKeyDown !== b.handleInboundNumericKeyDown ||
    a.onOpenProductQuickEdit !== b.onOpenProductQuickEdit
  ) {
    return false
  }
  return true
}

const AdminHubInboundDraftLineRow = memo(function AdminHubInboundDraftLineRow({
  ln,
  idx,
  catalogListForInbound,
  removeInboundFormLine,
  updateInboundFormLine,
  selectInboundInputOnFocus,
  handleInboundNumericKeyDown,
  onOpenProductQuickEdit,
}) {
  const inboundDvtOptions = buildInboundDvtSelectOptions(catalogListForInbound, ln)
  const inboundDvtLocked = inboundDvtOptions.length <= 1

  const onUnitChange = useCallback(
    (e) => {
      const res = applyInboundLineUnitChange(catalogListForInbound, ln, e.target.value)
      if (!res.ok || !res.changed) return
      updateInboundFormLine(ln.lineId, res.line)
    },
    [catalogListForInbound, ln, updateInboundFormLine]
  )

  return (
    <tr id={inboundRowDomId(ln)} className="ah-inbound-draft-line-card">
      <td className="ah-inbound-ln-del ah-inbound-draft-td-del">
        <button
          type="button"
          className="ah-inbound-row-del"
          tabIndex={-1}
          aria-label="Xóa dòng (dùng chuột; Tab bỏ qua để nhập nhanh SL / Đơn giá / Giảm giá)"
          onClick={() => removeInboundFormLine(ln.lineId)}
        >
          ×
        </button>
      </td>
      <td className="ah-inbound-ln-stt ah-inbound-draft-td-stt">{idx + 1}</td>
      <td className="ah-inbound-ln-code ah-inbound-draft-td-code">
        {ln.code && ln.variantId ? (
          <a
            className="ah-inbound-line-code-link"
            href={buildOpenHangHoaGoodsAbsUrl(ln.variantId, String(ln.code || '').trim()) || '#'}
            target="_blank"
            rel="noopener noreferrer"
            title="Mở trang Hàng hóa — chi tiết sản phẩm (tab mới)"
            onClick={(e) => {
              const u = buildOpenHangHoaGoodsAbsUrl(ln.variantId, String(ln.code || '').trim())
              if (!u) e.preventDefault()
            }}
          >
            {ln.code}
          </a>
        ) : (
          ln.code || '—'
        )}
      </td>
      <td className="ah-inbound-draft-td-name">
        {typeof onOpenProductQuickEdit === 'function' && (ln.variantId || ln.code) ? (
          <button
            type="button"
            className="ah-inbound-product-name-btn ah-inbound-product-name-btn--clickable"
            onClick={(e) => {
              e.stopPropagation()
              onOpenProductQuickEdit(ln, catalogListForInbound)
            }}
            title="Sửa nhanh sản phẩm"
          >
            {ln.name || '—'}
          </button>
        ) : (
          ln.name || '—'
        )}
      </td>
      <td
        className="ah-inbound-ln-mid ah-inbound-ln-spread ah-inbound-draft-td-ncc"
        title="thuong_hieu (file danh mục / trường brand)"
      >
        {inboundLineThuongHieuResolved(ln, catalogListForInbound) || '—'}
      </td>
      <td className="ah-inbound-ln-mid ah-inbound-ln-dvt-cell ah-inbound-ln-spread">
        <select
          className={`ah-inbound-dvt-select${inboundDvtLocked ? ' ah-inbound-dvt-select--locked' : ''}`}
          aria-label={`Đơn vị tính ${ln.name}`}
          disabled={inboundDvtLocked}
          title={
            inboundDvtLocked
              ? 'Mặt hàng chỉ có một ĐVT trong danh mục'
              : 'Chọn ĐVT theo danh mục KiotViet'
          }
          value={normalizeCatalogUnitLabel(ln.unitLabel)}
          onChange={onUnitChange}
        >
          {inboundDvtOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </td>
      <td className="ah-inbound-ln-mid ah-inbound-ln-spread">
        <input
          className="ah-inbound-cell-input ah-inbound-cell-input--qty ah-inbound-cell-input--soft"
          type="text"
          inputMode="numeric"
          data-inbound-line={ln.lineId}
          data-inbound-field="qty"
          aria-label={`Số lượng ${ln.name}`}
          value={ln.qty === 0 ? '' : String(ln.qty)}
          onFocus={selectInboundInputOnFocus}
          onKeyDown={(e) => handleInboundNumericKeyDown(e, ln.lineId, 'qty')}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, '')
            const n = raw === '' ? 0 : Math.max(0, parseFloat(raw.replace(/,/g, '.')) || 0)
            updateInboundFormLine(ln.lineId, { qty: n })
          }}
        />
      </td>
      <td className="ah-inbound-ln-mid ah-inbound-ln-spread">
        <input
          className="ah-inbound-cell-input ah-inbound-cell-input--soft"
          type="text"
          inputMode="decimal"
          data-inbound-line={ln.lineId}
          data-inbound-field="unitPrice"
          aria-label={`Đơn giá ${ln.name}`}
          value={formatMoneyDraftVi(ln.unitPrice)}
          onFocus={selectInboundInputOnFocus}
          onKeyDown={(e) => handleInboundNumericKeyDown(e, ln.lineId, 'unitPrice')}
          onChange={(e) =>
            updateInboundFormLine(ln.lineId, {
              unitPrice: parseMoneyDraftVi(e.target.value),
            })
          }
        />
      </td>
      <td className="ah-inbound-ln-mid ah-inbound-ln-spread">
        <input
          className="ah-inbound-cell-input ah-inbound-cell-input--soft"
          type="text"
          inputMode="decimal"
          data-inbound-line={ln.lineId}
          data-inbound-field="lineDiscount"
          aria-label={`Giảm giá ${ln.name}`}
          value={formatMoneyDraftVi(ln.lineDiscount)}
          onFocus={selectInboundInputOnFocus}
          onKeyDown={(e) => handleInboundNumericKeyDown(e, ln.lineId, 'lineDiscount')}
          onChange={(e) =>
            updateInboundFormLine(ln.lineId, {
              lineDiscount: parseMoneyDraftVi(e.target.value),
            })
          }
        />
      </td>
      <td className="ah-inbound-ln-mid ah-inbound-ln-total ah-inbound-ln-spread ah-inbound-ln-total-cell">
        {inboundLineTotal(ln).toLocaleString('vi-VN')} đ
      </td>
    </tr>
  )
}, propsEqual)

export default AdminHubInboundDraftLineRow

import { memo, useMemo } from 'react'
import { formatDisplayTonKhoVi } from './displayStockQty.js'

/** Giá trị tồn thô trên dòng lưới Hàng hóa (ưu tiên ton_kho). */
function tonKhoRawFromGoodsRow(row) {
  if (row.ton_kho != null && Number.isFinite(Number(row.ton_kho))) return Number(row.ton_kho)
  if (row.stock != null && Number.isFinite(Number(row.stock))) return Number(row.stock)
  return null
}

function goodsRowSnapshotEqual(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.ton_kho === b.ton_kho &&
    a.stock === b.stock &&
    a.quy_doi === b.quy_doi &&
    Number(a.price) === Number(b.price) &&
    Number(a.cost) === Number(b.cost) &&
    a.name === b.name &&
    a.code === b.code &&
    a.displayTime === b.displayTime &&
    a.brand === b.brand &&
    (a.dvt ?? '') === (b.dvt ?? '') &&
    (a.unitLabel ?? '') === (b.unitLabel ?? '')
  )
}

function GoodsCatalogDvtCell({ row }) {
  const dvt = String(row?.dvt ?? row?.unitLabel ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!dvt) return '—'
  const isNumeric = /^\d+(?:[.,]\d+)?$/.test(dvt)
  if (isNumeric) {
    return (
      <span className="ah-goods-dvt-error" role="alert" title={`record.dvt = «${dvt}» — có vẻ là quy_doi (số)`}>
        Sai dữ liệu: ô đơn vị không được là chỉ số ({dvt}). Kiểm tra file CSV hoặc tải lại danh mục.
      </span>
    )
  }
  return dvt
}

function goodsDataRowPropsEqual(prev, next) {
  return (
    goodsRowSnapshotEqual(prev.row, next.row) &&
    prev.selected === next.selected &&
    prev.isOpen === next.isOpen &&
    prev.onRowClick === next.onRowClick &&
    prev.onToggleSelect === next.onToggleSelect
  )
}

/** Một dòng bảng danh mục (không gồm panel chi tiết) — memo để gõ modal tạo hàng không làm re-render cả danh sách. */
export const GoodsCatalogDataRow = memo(function GoodsCatalogDataRow({
  row,
  selected,
  isOpen,
  onRowClick,
  onToggleSelect,
}) {
  const tonDisplayStr = useMemo(
    () => formatDisplayTonKhoVi(tonKhoRawFromGoodsRow(row), row),
    [
      row.ton_kho,
      row.stock,
      row.quy_doi,
      row.conversion,
      row.conversionValue,
      row.raw?.quy_doi,
      row.code,
    ]
  )
  return (
    <tr
      className={`ah-goods-data-row${isOpen ? ' ah-goods-data-row--open' : ''}`}
      onClick={() => onRowClick(row.id)}
    >
      <td className="ah-goods-col-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(row.id)}
          aria-label={`Chọn ${row.code}`}
        />
      </td>
      <td className="ah-goods-code">{row.code || '—'}</td>
      <td className="ah-goods-col-name">{row.name}</td>
      <td className="ah-goods-col-dvt">
        <GoodsCatalogDvtCell row={row} />
      </td>
      <td className="ah-goods-col-brand">{row.brand ? row.brand : ''}</td>
      <td className="ah-num">{row.price.toLocaleString('vi-VN')} đ</td>
      <td className="ah-num">{row.cost.toLocaleString('vi-VN')} đ</td>
      <td className="ah-num ah-goods-ton-cell">{tonDisplayStr}</td>
      <td className="ah-goods-time ah-goods-col-time">{row.displayTime}</td>
    </tr>
  )
}, goodsDataRowPropsEqual)

function goodsVirtualRowPropsEqual(prev, next) {
  return (
    goodsRowSnapshotEqual(prev.row, next.row) &&
    prev.selected === next.selected &&
    prev.isOpen === next.isOpen &&
    prev.onRowClick === next.onRowClick &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onGoodsMobileDelete === next.onGoodsMobileDelete
  )
}

function IconTrashMobile({ className }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconDetailMobile({ className }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Dòng lưới ảo (div + grid) — format tiền chỉ khi dòng được mount (đang trong viewport). */
export const GoodsCatalogVirtualDataRow = memo(function GoodsCatalogVirtualDataRow({
  row,
  selected,
  isOpen,
  onRowClick,
  onToggleSelect,
  onGoodsMobileDelete,
}) {
  const priceStr = (Number(row.price) || 0).toLocaleString('vi-VN')
  const costStr = (Number(row.cost) || 0).toLocaleString('vi-VN')
  const stockStr = useMemo(
    () => formatDisplayTonKhoVi(tonKhoRawFromGoodsRow(row), row),
    [
      row.ton_kho,
      row.stock,
      row.quy_doi,
      row.conversion,
      row.conversionValue,
      row.raw?.quy_doi,
      row.code,
    ]
  )
  const codeDisp = row.code || '—'
  const brandDisp = row.brand ? String(row.brand).trim() : ''

  return (
    <div className="ah-goods-vrow-root">
      <div
        role="row"
        className={`ah-goods-vrow ah-goods-vrow--desktop ah-goods-data-row${isOpen ? ' ah-goods-data-row--open' : ''}`}
        onClick={() => onRowClick(row.id)}
      >
        <div className="ah-goods-vcell ah-goods-col-check" role="cell" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(row.id)}
            aria-label={`Chọn ${row.code}`}
          />
        </div>
        <div className="ah-goods-vcell ah-goods-code" role="cell">
          {codeDisp}
        </div>
        <div className="ah-goods-vcell ah-goods-col-name" role="cell">
          {row.name}
        </div>
        <div className="ah-goods-vcell ah-goods-col-dvt" role="cell">
          <GoodsCatalogDvtCell row={row} />
        </div>
        <div className="ah-goods-vcell ah-goods-col-brand" role="cell" title={brandDisp}>
          {brandDisp}
        </div>
        <div className="ah-goods-vcell ah-num" role="cell">
          {priceStr} đ
        </div>
        <div className="ah-goods-vcell ah-num" role="cell">
          {costStr} đ
        </div>
        <div className="ah-goods-vcell ah-num" role="cell">
          {stockStr}
        </div>
        <div className="ah-goods-vcell ah-goods-time ah-goods-col-time" role="cell">
          {row.displayTime}
        </div>
      </div>

      <article
        className={`ah-goods-mobile-card ah-goods-data-row${isOpen ? ' ah-goods-data-row--open' : ''}`}
        aria-label={row.name}
      >
        <h3 className="ah-goods-mobile-card-title">{row.name}</h3>
        <div className="ah-goods-mobile-card-meta">
          <span className="ah-goods-mobile-card-code">Mã: {codeDisp}</span>
          {brandDisp ? (
            <>
              <span className="ah-goods-mobile-card-meta-sep" aria-hidden>
                ·
              </span>
              <span className="ah-goods-mobile-card-brand">{brandDisp}</span>
            </>
          ) : null}
        </div>
        <div className="ah-goods-mobile-card-main">
          <div className="ah-goods-mobile-card-price">
            <span className="ah-goods-mobile-card-price-lbl">Giá bán</span>
            <span className="ah-goods-mobile-card-price-val">
              {priceStr} đ
            </span>
          </div>
          <div className="ah-goods-mobile-card-stock">
            <span className="ah-goods-mobile-card-stock-lbl">Tồn kho</span>
            <span className="ah-goods-mobile-card-stock-val">{stockStr}</span>
          </div>
        </div>
        <div className="ah-goods-mobile-card-actions">
          <label
            className="ah-goods-mobile-card-check"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(row.id)}
              aria-label={`Chọn ${row.code}`}
            />
          </label>
          <button
            type="button"
            className="ah-goods-mobile-btn ah-goods-mobile-btn--danger"
            aria-label={`Xóa ${row.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onGoodsMobileDelete?.(row.id)
            }}
          >
            <IconTrashMobile className="ah-goods-mobile-btn-icon" />
            <span>Xóa</span>
          </button>
          <button
            type="button"
            className="ah-goods-mobile-btn ah-goods-mobile-btn--primary"
            aria-label={`Xem chi tiết ${row.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onRowClick(row.id)
            }}
          >
            <IconDetailMobile className="ah-goods-mobile-btn-icon" />
            <span>Chi tiết</span>
          </button>
        </div>
      </article>
    </div>
  )
}, goodsVirtualRowPropsEqual)

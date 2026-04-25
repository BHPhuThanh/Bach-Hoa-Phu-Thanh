import { memo } from 'react'

function goodsDataRowPropsEqual(prev, next) {
  return (
    prev.row === next.row &&
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
      <td className="ah-goods-col-dvt">{row.unitLabel}</td>
      <td className="ah-goods-col-brand">{row.brand ? row.brand : ''}</td>
      <td className="ah-num">{row.price.toLocaleString('vi-VN')} đ</td>
      <td className="ah-num">{row.cost.toLocaleString('vi-VN')} đ</td>
      <td className="ah-num">{row.stock != null ? row.stock.toLocaleString('vi-VN') : '—'}</td>
      <td className="ah-goods-time ah-goods-col-time">{row.displayTime}</td>
    </tr>
  )
}, goodsDataRowPropsEqual)

function goodsVirtualRowPropsEqual(prev, next) {
  return (
    prev.row === next.row &&
    prev.selected === next.selected &&
    prev.isOpen === next.isOpen &&
    prev.onRowClick === next.onRowClick &&
    prev.onToggleSelect === next.onToggleSelect
  )
}

/** Dòng lưới ảo (div + grid) — format tiền chỉ khi dòng được mount (đang trong viewport). */
export const GoodsCatalogVirtualDataRow = memo(function GoodsCatalogVirtualDataRow({
  row,
  selected,
  isOpen,
  onRowClick,
  onToggleSelect,
}) {
  const priceStr = (Number(row.price) || 0).toLocaleString('vi-VN')
  const costStr = (Number(row.cost) || 0).toLocaleString('vi-VN')
  const stockStr =
    row.stock != null && Number.isFinite(Number(row.stock))
      ? Number(row.stock).toLocaleString('vi-VN')
      : '—'
  return (
    <div
      role="row"
      className={`ah-goods-vrow ah-goods-data-row${isOpen ? ' ah-goods-data-row--open' : ''}`}
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
        {row.code || '—'}
      </div>
      <div className="ah-goods-vcell ah-goods-col-name" role="cell">
        {row.name}
      </div>
      <div className="ah-goods-vcell ah-goods-col-dvt" role="cell">
        {row.unitLabel}
      </div>
      <div className="ah-goods-vcell ah-goods-col-brand" role="cell" title={row.brand || ''}>
        {row.brand ? row.brand : ''}
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
  )
}, goodsVirtualRowPropsEqual)

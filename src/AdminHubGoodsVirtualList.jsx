import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { List } from 'react-window'
import { GoodsCatalogVirtualDataRow } from './AdminHubGoodsCatalogRows.jsx'

const ROW_H_DESKTOP = 46

/** Chiều cao thẻ mobile (đồng bộ với CSS .ah-goods-mobile-card) — dùng cho react-window. */
const ROW_H_MOBILE = 188

const GOODS_DETAIL_EXTRA_DESKTOP = 560

/** Giữ tỉ lệ mở chi tiết; hơi thấp hơn để cuộn dễ trên điện thoại. */
const GOODS_DETAIL_EXTRA_MOBILE = 480

const MOBILE_GOODS_MQ = '(max-width: 768px)'

function useGoodsCatalogMobileLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_GOODS_MQ).matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_GOODS_MQ)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

function GoodsVirtualRow(props) {
  const {
    index,
    style,
    ariaAttributes,
    rows,
    goodsExpandedId,
    goodsSelected,
    toggleGoodsRowExpand,
    toggleGoodsSelect,
    onGoodsMobileDelete,
    expandedSlot,
  } = props
  const row = rows[index]
  if (!row) return null
  const open = goodsExpandedId === row.id
  return (
    <div className="ah-goods-vitem" style={style} {...ariaAttributes}>
      <GoodsCatalogVirtualDataRow
        row={row}
        selected={!!goodsSelected[row.id]}
        isOpen={open}
        onRowClick={toggleGoodsRowExpand}
        onToggleSelect={toggleGoodsSelect}
        onGoodsMobileDelete={onGoodsMobileDelete}
      />
      {open && expandedSlot ? <div className="ah-goods-vdetail-wrap">{expandedSlot}</div> : null}
    </div>
  )
}

export const AdminHubGoodsVirtualList = memo(function AdminHubGoodsVirtualList({
  height,
  width,
  rows,
  goodsExpandedId,
  goodsSelected,
  toggleGoodsRowExpand,
  toggleGoodsSelect,
  onGoodsMobileDelete,
  expandedSlot,
  listResetKey,
}) {
  const isMobileGoods = useGoodsCatalogMobileLayout()
  const rowCompact = isMobileGoods ? ROW_H_MOBILE : ROW_H_DESKTOP
  const detailExtra = isMobileGoods ? GOODS_DETAIL_EXTRA_MOBILE : GOODS_DETAIL_EXTRA_DESKTOP

  const rowProps = useMemo(
    () => ({
      rows,
      goodsExpandedId,
      goodsSelected,
      toggleGoodsRowExpand,
      toggleGoodsSelect,
      onGoodsMobileDelete,
      expandedSlot,
    }),
    [
      rows,
      goodsExpandedId,
      goodsSelected,
      toggleGoodsRowExpand,
      toggleGoodsSelect,
      onGoodsMobileDelete,
      expandedSlot,
    ]
  )

  const rowHeight = useCallback(
    (index, rp) => {
      const r = rp.rows[index]
      if (!r) return rowCompact
      return rowCompact + (rp.goodsExpandedId === r.id ? detailExtra : 0)
    },
    [rowCompact, detailExtra]
  )

  if (height < ROW_H_DESKTOP || width < 80 || !rows.length) return null

  return (
    <List
      key={`${listResetKey}|mq:${isMobileGoods ? 'm' : 'd'}`}
      rowCount={rows.length}
      rowHeight={rowHeight}
      rowProps={rowProps}
      rowComponent={GoodsVirtualRow}
      overscanCount={10}
      style={{ height, width }}
    />
  )
})

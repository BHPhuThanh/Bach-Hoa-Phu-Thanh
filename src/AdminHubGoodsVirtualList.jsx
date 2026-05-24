import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { List } from 'react-window'
import { GoodsCatalogVirtualDataRow } from './AdminHubGoodsCatalogRows.jsx'

const ROW_H_DESKTOP = 46

/** Chiều cao thẻ mobile (đồng bộ với CSS .ah-goods-mobile-card) — dùng cho react-window. */
const ROW_H_MOBILE = 188

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
    productQuickEditExpandId,
    goodsSelected,
    onOpenProductQuickEdit,
    toggleGoodsSelect,
    onGoodsMobileDelete,
  } = props
  const row = rows[index]
  if (!row) return null
  const isOpen = productQuickEditExpandId === row.id
  return (
    <div className="ah-goods-vitem" style={style} data-goods-row-id={row.id} {...ariaAttributes}>
      <GoodsCatalogVirtualDataRow
        row={row}
        selected={!!goodsSelected[row.id]}
        isOpen={isOpen}
        onRowClick={onOpenProductQuickEdit}
        onToggleSelect={toggleGoodsSelect}
        onGoodsMobileDelete={onGoodsMobileDelete}
      />
    </div>
  )
}

export const AdminHubGoodsVirtualList = memo(function AdminHubGoodsVirtualList({
  height,
  width,
  rows,
  productQuickEditExpandId,
  goodsSelected,
  onOpenProductQuickEdit,
  toggleGoodsSelect,
  onGoodsMobileDelete,
  listResetKey,
}) {
  const isMobileGoods = useGoodsCatalogMobileLayout()
  const rowHeight = isMobileGoods ? ROW_H_MOBILE : ROW_H_DESKTOP

  const rowProps = useMemo(
    () => ({
      rows,
      productQuickEditExpandId,
      goodsSelected,
      onOpenProductQuickEdit,
      toggleGoodsSelect,
      onGoodsMobileDelete,
    }),
    [
      rows,
      productQuickEditExpandId,
      goodsSelected,
      onOpenProductQuickEdit,
      toggleGoodsSelect,
      onGoodsMobileDelete,
    ]
  )

  const getRowHeight = useCallback(() => rowHeight, [rowHeight])

  if (height < ROW_H_DESKTOP || width < 80 || !rows.length) return null

  return (
    <List
      key={`${listResetKey}|mq:${isMobileGoods ? 'm' : 'd'}`}
      rowCount={rows.length}
      rowHeight={getRowHeight}
      rowProps={rowProps}
      rowComponent={GoodsVirtualRow}
      overscanCount={10}
      style={{ height, width }}
    />
  )
})

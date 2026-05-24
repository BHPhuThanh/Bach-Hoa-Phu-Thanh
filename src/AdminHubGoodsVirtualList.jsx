import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { List, useListRef } from 'react-window'
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

export const AdminHubGoodsVirtualList = memo(
  forwardRef(function AdminHubGoodsVirtualList(
    {
      height,
      width,
      rows,
      productQuickEditExpandId,
      goodsSelected,
      onOpenProductQuickEdit,
      toggleGoodsSelect,
      onGoodsMobileDelete,
      listResetKey,
    },
    ref
  ) {
  const isMobileGoods = useGoodsCatalogMobileLayout()
  const rowHeight = isMobileGoods ? ROW_H_MOBILE : ROW_H_DESKTOP
  const listRef = useListRef()

  useImperativeHandle(
    ref,
    () => ({
      scrollVariantIntoViewCenter(variantId) {
        const id = String(variantId ?? '').trim()
        if (!id || !rows?.length) return false
        const idx = rows.findIndex((r) => String(r.id) === id)
        if (idx < 0) return false
        listRef.current?.scrollToRow?.({ index: idx, align: 'center', behavior: 'smooth' })
        return true
      },
    }),
    [rows, listRef]
  )

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
      listRef={listRef}
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
)

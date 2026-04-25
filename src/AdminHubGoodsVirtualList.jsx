import { memo, useCallback, useMemo } from 'react'
import { List } from 'react-window'
import { GoodsCatalogVirtualDataRow } from './AdminHubGoodsCatalogRows.jsx'

const ROW_H = 46
const DETAIL_H = 560

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
  expandedSlot,
  listResetKey,
}) {
  const rowProps = useMemo(
    () => ({
      rows,
      goodsExpandedId,
      goodsSelected,
      toggleGoodsRowExpand,
      toggleGoodsSelect,
      expandedSlot,
    }),
    [rows, goodsExpandedId, goodsSelected, toggleGoodsRowExpand, toggleGoodsSelect, expandedSlot]
  )

  const rowHeight = useCallback((index, rp) => {
    const r = rp.rows[index]
    if (!r) return ROW_H
    return rp.goodsExpandedId === r.id ? ROW_H + DETAIL_H : ROW_H
  }, [])

  if (height < ROW_H || width < 80 || !rows.length) return null

  return (
    <List
      key={listResetKey}
      rowCount={rows.length}
      rowHeight={rowHeight}
      rowProps={rowProps}
      rowComponent={GoodsVirtualRow}
      overscanCount={10}
      style={{ height, width }}
    />
  )
})

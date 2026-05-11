import { memo, useMemo } from 'react'
import { List } from 'react-window'

function UniformRow({ index, style, ariaAttributes, rows, renderRow }) {
  const row = rows[index]
  if (!row) return null
  return (
    <div style={style} {...ariaAttributes}>
      {renderRow(row, index)}
    </div>
  )
}

/**
 * Danh sách dọc cố định chiều cao dòng — dùng cho NCC / khách hàng dài.
 * `renderRow(row, index)` trả về nội dung một dòng (không bọc style — đã có ngoài).
 */
export const SimpleVirtualList = memo(function SimpleVirtualList({
  height,
  width,
  rows,
  rowHeight,
  renderRow,
  overscanCount = 8,
}) {
  const rowProps = useMemo(() => ({ rows, renderRow }), [rows, renderRow])
  if (!rows?.length || height < rowHeight || width < 40) return null

  return (
    <List
      rowCount={rows.length}
      rowHeight={rowHeight}
      rowComponent={UniformRow}
      rowProps={rowProps}
      overscanCount={overscanCount}
      style={{ height, width }}
    />
  )
})

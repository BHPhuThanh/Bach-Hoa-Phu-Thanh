import * as XLSX from 'xlsx'
import { orderTotalCost, orderTotalProfit } from './reportUtils.js'

function fileStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/**
 * @param {Array<{ invoiceNo: string, createdAt: string, total: number, items: object[] }>} orders
 */
export function exportOrdersToExcel(orders) {
  const header = [
    'Mã đơn',
    'Ngày giờ',
    'Doanh thu (đ)',
    'Giá vốn (đ)',
    'Lợi nhuận (đ)',
    'Số dòng',
    'Chi tiết món',
  ]
  const rows = [header]
  for (const o of orders) {
    const detail = (o.items || [])
      .map((i) => `${i.name} × ${i.qty} @ ${Number(i.price).toLocaleString('vi-VN')}`)
      .join(' | ')
    rows.push([
      o.invoiceNo,
      new Date(o.createdAt).toLocaleString('vi-VN'),
      o.total,
      orderTotalCost(o),
      orderTotalProfit(o),
      (o.items || []).length,
      detail,
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 8 },
    { wch: 55 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Đơn hàng')
  XLSX.writeFile(wb, `bao-cao-don-hang-${fileStamp()}.xlsx`)
}

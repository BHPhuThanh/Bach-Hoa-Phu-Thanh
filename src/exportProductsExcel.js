import * as XLSX from 'xlsx'

function fileStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function escapeCsvField(value, delim) {
  const str = String(value ?? '')
  if (str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(delim)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * CSV Kiot-style `;` — cột D (index 3) là «Thương hiệu» để nhập lại khớp parser.
 * @param {Array<{ code: string, name: string, barcode?: string, unitLabel?: string, brand?: string, price: number, cost: number, stock: number|null, displayTime: string }>} rows
 */
export function exportGoodsRowsToKiotCsv(rows) {
  if (!rows?.length) return false
  const delim = ';'
  const header = [
    'Mã hàng',
    'Mã vạch',
    'Tên hàng',
    'Thương hiệu',
    'ĐVT',
    'Giá bán (đ)',
    'Giá vốn (đ)',
    'Tồn kho',
    'Thời gian tạo',
  ]
  const lines = [header.map((h) => escapeCsvField(h, delim)).join(delim)]
  for (const r of rows) {
    const cells = [
      r.code,
      r.barcode || '',
      r.name,
      r.brand || '',
      r.unitLabel || 'Cái',
      r.price,
      r.cost,
      r.stock != null ? r.stock : '',
      r.displayTime || '',
    ]
    lines.push(cells.map((c) => escapeCsvField(c, delim)).join(delim))
  }
  const bom = '\uFEFF'
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `hang-hoa-${fileStamp()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  return true
}

/**
 * @param {Array<{ code: string, name: string, barcode?: string, unitLabel?: string, brand?: string, price: number, cost: number, stock: number|null, displayTime: string }>} rows
 */
export function exportGoodsRowsToExcel(rows) {
  if (!rows?.length) return false
  const header = [
    'Mã hàng',
    'Mã vạch',
    'Tên hàng',
    'Thương hiệu',
    'ĐVT',
    'Giá bán (đ)',
    'Giá vốn (đ)',
    'Tồn kho',
    'Thời gian tạo',
  ]
  const data = [header]
  for (const r of rows) {
    data.push([
      r.code,
      r.barcode || '',
      r.name,
      r.brand || '',
      r.unitLabel || 'Cái',
      r.price,
      r.cost,
      r.stock != null ? r.stock : '',
      r.displayTime || '',
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 36 },
    { wch: 18 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 20 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hàng hóa')
  XLSX.writeFile(wb, `hang-hoa-${fileStamp()}.xlsx`)
  return true
}

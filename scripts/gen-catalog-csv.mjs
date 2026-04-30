import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const appPath = path.join(root, 'src', 'App.jsx')
const outPath = path.join(root, 'src', 'catalogCsv.js')

const lines = fs.readFileSync(appPath, 'utf8').split(/\n/)

function lineIndex(pred) {
  const i = lines.findIndex(pred)
  if (i < 0) throw new Error('Marker line not found in App.jsx')
  return i
}

const iParse = lineIndex((l) => l.startsWith('function parseDelimitedLine'))
const iEff = lineIndex((l) => l.startsWith('function effectiveSellUnitPrice'))
const iCost = lineIndex((l) => l.startsWith('function headerIsCostColumn'))
const iNewCart = lineIndex((l) => l.startsWith('function newCartLineId'))

const part1 = lines.slice(iParse, iEff).join('\n')
const part2 = lines.slice(iCost, iNewCart).join('\n')

const head = `import * as XLSX from 'xlsx'
import {
  EXCEL_CATALOG_UNIT_COLUMN_INDEX_L,
  buildDisplayCatalog,
  headerIsConversionColumn,
  headerIsLinkedMasterColumn,
  normalizeCatalogUnitLabel,
  parseConversionRatio,
  pickUnitColumnIndex,
  shouldForceProductCodeColumnA,
} from './productUnits.js'

/* Đồng bộ với App.jsx (đoạn parse CSV): chạy \`node scripts/gen-catalog-csv.mjs\` sau khi sửa logic nhận cột. */

`

const foot = `
export function parseCsvTextToDisplayCatalog(text, fileName = '') {
  const lines = splitLines(text).filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { error: 'File trống hoặc không có nội dung.', products: [], rowCount: 0, fileName }
  }
  const delim = detectDelimiter(lines[0])
  const headerCells = parseDelimitedLine(lines[0], delim)
  const dataLines = lines.slice(1)
  if (dataLines.length === 0) {
    return { error: 'CSV chỉ có dòng tiêu đề, chưa có sản phẩm.', products: [], rowCount: 0, fileName }
  }
  const dataRows = dataLines.map((line) => parseDelimitedLine(line, delim))
  const importBaseMs = Date.now()
  const flat = rowsToProducts(headerCells, dataRows, delim, importBaseMs)
  const products = buildDisplayCatalog(flat)
  return { products, rowCount: dataRows.length, error: null, fileName }
}

function padExcelCatalogRow(r, nCols) {
  const row = Array.isArray(r) ? [...r] : []
  while (row.length < nCols) row.push('')
  return row.map((c) => {
    if (c == null || c === '') return ''
    if (typeof c === 'number' && Number.isFinite(c)) {
      if (Number.isInteger(c) && String(Math.abs(Math.trunc(c))).length > 12) return String(Math.trunc(c))
      return String(c)
    }
    return String(c).trim()
  })
}

/** Đọc đúng ô cột L (0-based) từ worksheet — tránh mất chuỗi dùng chung / dòng thưa khi chỉ dùng sheet_to_json. */
function readSheetColumnLUnit(ws, sheetRow0Based) {
  if (!ws || sheetRow0Based < 0) return ''
  const addr = XLSX.utils.encode_cell({ r: sheetRow0Based, c: EXCEL_CATALOG_UNIT_COLUMN_INDEX_L })
  const cell = ws[addr]
  if (!cell || cell.t === 'z') return ''
  try {
    const s = XLSX.utils.format_cell(cell)
    return String(s ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    if (cell.w != null)
      return String(cell.w)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (cell.v != null && cell.t !== 'e')
      return String(cell.v)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return ''
  }
}

/** Nhập CSV hoặc Excel (.xlsx / .xls) — cùng logic cột ĐƠN VỊ TÍNH với màn Bán hàng. */
export async function parseCatalogBlobFile(file) {
  const fileName = file?.name || ''
  const ext = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase()
  const importBaseMs = Date.now()

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const sn0 = wb.SheetNames[0]
    if (!sn0) return { error: 'File Excel không có sheet.', products: [], rowCount: 0, fileName }
    const ws = wb.Sheets[sn0]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
    if (!rows.length) return { error: 'Sheet trống.', products: [], rowCount: 0, fileName }
    const nColsRaw = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0)
    const nCols = Math.max(nColsRaw, EXCEL_CATALOG_UNIT_COLUMN_INDEX_L + 1)
    const headerCells = padExcelCatalogRow(rows[0], nCols)
    const dataRows = rows
      .slice(1)
      .map((r, idx) => {
        const pad = padExcelCatalogRow(r, nCols)
        const sheetRow0 = idx + 1
        pad[EXCEL_CATALOG_UNIT_COLUMN_INDEX_L] = readSheetColumnLUnit(ws, sheetRow0)
        return pad
      })
      .filter((cells) => cells.some((c) => String(c).trim() !== ''))
    if (dataRows.length === 0) {
      return {
        error: 'Sheet chỉ có tiêu đề, chưa có dòng dữ liệu.',
        products: [],
        rowCount: 0,
        fileName,
      }
    }
    const flat = rowsToProducts(headerCells, dataRows, '', importBaseMs, { excelUnitFromColumnL: true })
    const products = buildDisplayCatalog(flat)
    return { products, rowCount: dataRows.length, error: null, fileName }
  }

  const text = String(await file.text()).replace(/^\\uFEFF/, '')
  return parseCsvTextToDisplayCatalog(text, fileName)
}

export { normalizeHeaderCell, normalizeBarcodeValue }
`

fs.writeFileSync(outPath, `${head}${part1}\n${part2}${foot}`)
console.log('Wrote', outPath, fs.statSync(outPath).size, 'bytes')

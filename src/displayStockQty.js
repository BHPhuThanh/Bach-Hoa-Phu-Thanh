/**
 * Hiển thị tồn kho: `parseFloat((Number(ton_kho) / Number(quy_doi)).toFixed(4))` — ưu tiên cột `quy_doi`;
 * chỉ UI, không đổi giá trị lưu catalog. Số nguyên hiển thị gọn (8 không thành 8.0000).
 *
 * Mẫu số: ưu tiên `raw.quy_doi` / `quy_doi` (Kiot), sau đó fallback `conversion` / `catalogQuyDoiFactorToBase`.
 */
import { catalogQuyDoiFactorToBase, parseConversionRatio } from './productUnits.js'

function effectiveQuyDoiScalar(raw) {
  if (raw == null || raw === '') return 1
  const num = Number(raw)
  if (Number.isFinite(num) && num > 0) return num
  if (typeof raw === 'string' && !String(raw).trim()) return 1
  const p = parseConversionRatio(String(raw))
  return p != null && p > 0 ? p : 1
}

/**
 * Mẫu số hiển thị: ưu tiên `Number(quy_doi)` từ CSV; fallback conversion nội bộ.
 * @param {object} row
 */
function quyDoiDenominatorForDisplay(row) {
  const raw = row?.raw?.quy_doi ?? row?.quy_doi ?? row?.quyDoi
  const hieu_suat = Number(raw)
  if (Number.isFinite(hieu_suat) && hieu_suat > 0) return hieu_suat
  if (raw != null && String(raw).trim()) {
    const p = parseConversionRatio(String(raw))
    if (p != null && p > 0) return p
  }
  const fb = catalogQuyDoiFactorToBase(row)
  return Number.isFinite(fb) && fb > 0 ? fb : 1
}

/** Chuỗi hiển thị sau `parseFloat(…toFixed(4))` — bỏ số 0 thập phân thừa. */
export function formatStockQtyDisplayVi(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const x = parseFloat(Number(n).toFixed(4))
  return String(x)
}

/**
 * @param {unknown} tonKhoRaw — giá trị từ cột tồn (ton_kho)
 * @param {unknown} quyDoiOrVariant — số quy_doi hoặc object biến thể có conversion / conversionValue
 * @returns {number | null}
 */
export function displayTonKhoNumber(tonKhoRaw, quyDoiOrVariant) {
  const ton = Number(tonKhoRaw)
  if (!Number.isFinite(ton)) return null
  const denom =
    quyDoiOrVariant != null && typeof quyDoiOrVariant === 'object'
      ? quyDoiDenominatorForDisplay(quyDoiOrVariant)
      : effectiveQuyDoiScalar(quyDoiOrVariant)
  const d = Number.isFinite(Number(denom)) && Number(denom) > 0 ? Number(denom) : 1
  return parseFloat((ton / d).toFixed(4))
}

/**
 * @param {unknown} tonKhoRaw — ton_kho (hoặc stock tương đương)
 * @param {unknown} quyDoiOrVariant — hệ số quy đổi, hoặc **object dòng** (`row`) có `quy_doi` / `conversion` / `raw.quy_doi`
 */
export function formatDisplayTonKhoVi(tonKhoRaw, quyDoiOrVariant) {
  const n = displayTonKhoNumber(tonKhoRaw, quyDoiOrVariant)
  if (n == null) return '—'
  return formatStockQtyDisplayVi(n)
}

/** Nhãn gợi ý phiếu nhập: "Tồn: …" theo ton_kho / quy_doi. */
export function formatInboundTonLabelVi(stockQty, variant) {
  const n = displayTonKhoNumber(stockQty, variant ?? {})
  if (n == null) return 'Tồn: —'
  return `Tồn: ${formatStockQtyDisplayVi(n)}`
}

/** Số lượng bán / tồn tính sẵn (POS, lô…) — cùng chuẩn `parseFloat(toFixed(4))`. */
export function formatRoundedStockQtyVi(n) {
  return formatStockQtyDisplayVi(n)
}

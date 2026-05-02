/**
 * Hiển thị tồn kho theo công thức: ton_kho / quy_doi (quy_doi ≤ 0 hoặc thiếu → 1),
 * làm tròn tối đa 4 chữ số thập phân — chỉ dùng cho UI, không thay thế giá trị lưu trong catalog.
 */
import { catalogQuyDoiFactorToBase, parseConversionRatio } from './productUnits.js'

function effectiveQuyDoiScalar(raw) {
  if (raw == null || (typeof raw === 'string' && !String(raw).trim())) return 1
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  const p = parseConversionRatio(String(raw))
  return p != null && p > 0 ? p : 1
}

/**
 * @param {unknown} tonKhoRaw — giá trị từ cột tồn (ton_kho)
 * @param {unknown} quyDoiOrVariant — số quy_doi hoặc object biến thể có conversion / conversionValue
 * @returns {number | null}
 */
export function displayTonKhoNumber(tonKhoRaw, quyDoiOrVariant) {
  const ton = Number(tonKhoRaw)
  if (!Number.isFinite(ton)) return null
  const q =
    quyDoiOrVariant != null && typeof quyDoiOrVariant === 'object'
      ? catalogQuyDoiFactorToBase(quyDoiOrVariant)
      : effectiveQuyDoiScalar(quyDoiOrVariant)
  return Math.round((ton / q) * 1e4) / 1e4
}

export function formatDisplayTonKhoVi(tonKhoRaw, quyDoiOrVariant) {
  const n = displayTonKhoNumber(tonKhoRaw, quyDoiOrVariant)
  if (n == null) return '—'
  return n.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

/** Nhãn gợi ý phiếu nhập: "Tồn: …" theo ton_kho / quy_doi. */
export function formatInboundTonLabelVi(stockQty, variant) {
  const n = displayTonKhoNumber(stockQty, variant ?? {})
  if (n == null) return 'Tồn: —'
  const body = n.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
  return `Tồn: ${body}`
}

/** Số lượng bán/ tồn tính sẵn (vd. "có thể bán") — làm tròn 4 chữ số thập phân khi hiển thị. */
export function formatRoundedStockQtyVi(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const x = Math.round(Number(n) * 1e4) / 1e4
  return x.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

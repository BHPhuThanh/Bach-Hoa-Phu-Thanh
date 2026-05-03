/**
 * Hiển thị tồn kho theo công thức: ton_kho / quy_doi (quy_doi ≤ 0 hoặc thiếu → 1).
 * `formatDisplayTonKhoVi`: luôn **4** chữ số thập phân — chỉ UI, không thay giá trị lưu catalog.
 * Dấu thập phân dùng **chấm** (.), giống nhiều phần mềm bán hàng — tránh nhầm với hàng nghìn.
 *
 * Hệ số quy đổi: ưu tiên `quy_doi` / `raw.quy_doi` (CSV Kiot) trước `conversion` nội bộ —
 * tránh trường hợp conversion = 1 nhưng quy_doi = 12 (vd. thùng 12 lẻ) làm chia sai.
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
 * Mẫu số hiển thị tồn: ép kiểu `quy_doi` từ dòng/variant (ưu tiên CSV), fallback logic conversion cũ.
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
  const d = Number.isFinite(denom) && denom > 0 ? denom : 1
  return Math.round((ton / d) * 1e4) / 1e4
}

/**
 * @param {unknown} tonKhoRaw — ton_kho (hoặc stock tương đương)
 * @param {unknown} quyDoiOrVariant — hệ số quy đổi, hoặc **object dòng** (`row`) có `quy_doi` / `conversion` / `raw.quy_doi`
 */
export function formatDisplayTonKhoVi(tonKhoRaw, quyDoiOrVariant) {
  const n = displayTonKhoNumber(tonKhoRaw, quyDoiOrVariant)
  if (n == null) return '—'
  return n.toFixed(4)
}

/** Nhãn gợi ý phiếu nhập: "Tồn: …" theo ton_kho / quy_doi. */
export function formatInboundTonLabelVi(stockQty, variant) {
  const n = displayTonKhoNumber(stockQty, variant ?? {})
  if (n == null) return 'Tồn: —'
  return `Tồn: ${n.toFixed(4)}`
}

/** Số lượng bán/ tồn tính sẵn (vd. "có thể bán") — làm tròn 4 chữ số thập phân khi hiển thị. */
export function formatRoundedStockQtyVi(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const x = Math.round(Number(n) * 1e4) / 1e4
  return x.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

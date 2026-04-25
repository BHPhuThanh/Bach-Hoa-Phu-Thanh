/**
 * Ô nhập tiền (real-time): chỉ giữ chữ số, định dạng phân tách hàng nghìn en-US.
 * Lưu DB/CSV: dùng parseMoneyDigitsOnlyInt rồi ghi số nguyên, không có dấu phẩy.
 */
export function parseMoneyDigitsOnlyInt(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return null
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : null
}

export function formatMoneyThousandsTyping(raw) {
  const n = parseMoneyDigitsOnlyInt(raw)
  if (n === null) return ''
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

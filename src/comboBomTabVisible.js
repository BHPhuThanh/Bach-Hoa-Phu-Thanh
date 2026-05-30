/**
 * Hiển thị tab BOM combo — tách file tránh vòng import với comboCatalog.js.
 * @param {object | null | undefined} p — product catalog (nhóm hoặc biến thể)
 */
export function shouldShowComboBomTab(p) {
  if (!p) return false
  if (p.catalogProductType === 'combo' || p.isCombo === true) return true
  const gv = p.groupVariants
  if (Array.isArray(gv)) {
    const g0 = gv[0]
    if (g0?.catalogProductType === 'combo' || g0?.isCombo === true) return true
  }
  const raw = p.comboBom ?? gv?.[0]?.comboBom
  return Array.isArray(raw) && raw.length > 0
}

import { getSupabaseClient } from './supabaseClient.js'

/**
 * Cập nhật ĐVT / giá trên `products` — ép text, chỉ báo UI sau khi DB phản hồi.
 * @param {Array<{ ma_hang: string, ten_hang?: unknown, ton_kho?: unknown, gia_ban?: unknown, gia_von?: unknown, quy_doi?: unknown, dvt?: unknown, ma_hh_lien_quan?: unknown, linkedMasterCode?: unknown }>} items
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function updateProductDvtFieldsSequential(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) {
    return { ok: false, error: 'Không có dòng ĐVT để lưu.' }
  }
  const sb = getSupabaseClient()
  if (!sb) {
    return { ok: false, error: 'Không tạo được Supabase client.' }
  }

  for (const item of list) {
    const ma_hang = String(item.ma_hang ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim()
    if (!ma_hang) {
      return { ok: false, error: 'Thiếu ma_hang trong payload ĐVT.' }
    }

    const payload = {
      gia_ban: String(item.gia_ban ?? ''),
      gia_von: String(item.gia_von ?? ''),
    }
    const tenHang = String(item.ten_hang ?? '').trim()
    if (tenHang) {
      payload.ten_hang = tenHang
    }
    const linkedCode = String(item.ma_hh_lien_quan ?? item.linkedMasterCode ?? '').trim()
    if (linkedCode) {
      payload.ma_hh_lien_quan = linkedCode
    }
    if (item.quy_doi !== undefined && item.quy_doi !== null && String(item.quy_doi) !== '') {
      payload.quy_doi = String(item.quy_doi)
    }
    if (item.dvt !== undefined && item.dvt !== null && String(item.dvt).trim() !== '') {
      payload.dvt = String(item.dvt)
    }
    if (item.ton_kho !== undefined && item.ton_kho !== null && String(item.ton_kho) !== '') {
      const tk = Number(item.ton_kho)
      if (Number.isFinite(tk)) {
        payload.ton_kho = parseFloat(Math.max(0, tk).toFixed(3))
      }
    }

    const upsertRow = { ma_hang, ...payload }
    // Không .select() — response không được dùng ở đâu (PostgREST trả return=minimal, đỡ egress).
    const { error } = await sb
      .from('products')
      .upsert(upsertRow, { onConflict: 'ma_hang' })

    if (error) {
      console.error('LỖI UPDATE ĐVT:', error.message)
      return {
        ok: false,
        error: `Lỗi Supabase khi lưu ĐVT «${ma_hang}»: ${error.message}`,
      }
    }
  }

  return { ok: true }
}

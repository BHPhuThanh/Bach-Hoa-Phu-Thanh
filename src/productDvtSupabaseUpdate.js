import { getSupabaseClient } from './supabaseClient.js'

/**
 * Cập nhật ĐVT / giá trên `products` — ép text, chỉ báo UI sau khi DB phản hồi.
 * @param {Array<{ ma_hang: string, gia_ban?: unknown, gia_von?: unknown, quy_doi?: unknown, dvt?: unknown }>} items
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
    if (item.quy_doi !== undefined && item.quy_doi !== null && String(item.quy_doi) !== '') {
      payload.quy_doi = String(item.quy_doi)
    }
    if (item.dvt !== undefined && item.dvt !== null && String(item.dvt).trim() !== '') {
      payload.dvt = String(item.dvt)
    }

    const { data, error } = await sb
      .from('products')
      .update(payload)
      .eq('ma_hang', ma_hang)
      .select('ma_hang, dvt, quy_doi, gia_ban, gia_von')

    if (error) {
      console.error('LỖI UPDATE ĐVT:', error.message)
      return {
        ok: false,
        error: `Lỗi Supabase khi lưu ĐVT «${ma_hang}»: ${error.message}`,
      }
    }
    if (!Array.isArray(data) || data.length === 0) {
      const msg = `Supabase không cập nhật dòng nào cho ma_hang="${ma_hang}" — mã không tồn tại trên DB.`
      console.error('LỖI UPDATE ĐVT: 0 rows', { ma_hang, payload })
      return { ok: false, error: msg }
    }
  }

  return { ok: true }
}

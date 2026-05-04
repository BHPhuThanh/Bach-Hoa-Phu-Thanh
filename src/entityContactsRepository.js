/**
 * CRUD Supabase: suppliers, customers, employees — cùng schema (name, phone, address, cccd, mail).
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

function normalizePersonRow(row) {
  if (!row) return null
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? '').trim(),
    phone: String(row.phone ?? '').trim(),
    address: String(row.address ?? '').trim(),
    cccd: String(row.cccd ?? '').trim(),
    mail: String(row.mail ?? '').trim(),
    created_at: row.created_at ?? null,
  }
}

/**
 * Chuỗi hiển thị cho Alert — gồm mã PostgREST / Postgres khi có (vd. RLS 42501).
 * @param {unknown} err — PostgrestError hoặc Error
 */
export function formatPostgrestErrorForUser(err) {
  if (err == null) return 'Lỗi không xác định.'
  if (typeof err === 'string') return err
  const msg = typeof err.message === 'string' ? err.message : String(err)
  const code = err.code != null ? String(err.code) : ''
  const details = typeof err.details === 'string' && err.details.trim() ? err.details.trim() : ''
  const hint = typeof err.hint === 'string' && err.hint.trim() ? err.hint.trim() : ''
  const lines = ['Không lưu được dữ liệu lên máy chủ (Supabase).']
  if (code) lines.push(`Mã lỗi: ${code}`)
  if (msg) lines.push(msg)
  if (details) lines.push(details)
  if (hint) lines.push(`Gợi ý: ${hint}`)
  return lines.join('\n')
}

/** @param {'suppliers'|'customers'|'employees'} table */
async function insertPerson(table, payload) {
  const sb = getSupabaseClient()
  if (!sb || !isSupabaseConfigured()) {
    return { ok: false, skipped: true, error: new Error('Supabase chưa cấu hình') }
  }
  const row = {
    name: String(payload.name ?? '').trim(),
    phone: String(payload.phone ?? '').trim() || null,
    address: String(payload.address ?? '').trim() || null,
    cccd: String(payload.cccd ?? '').trim() || null,
    mail: String(payload.mail ?? '').trim() || null,
  }
  if (!row.name) {
    return { ok: false, error: new Error('Thiếu tên') }
  }
  try {
    const { data, error } = await sb.from(table).insert(row).select('*').single()
    if (error) {
      return { ok: false, error, code: error.code, message: error.message }
    }
    return { ok: true, row: normalizePersonRow(data) }
  } catch (e) {
    const err = /** @type {Error & { code?: string }} */ (e)
    return {
      ok: false,
      error: err,
      code: err?.code,
      message: err?.message ?? String(e),
    }
  }
}

/** @param {'suppliers'|'customers'|'employees'} table */
export async function fetchPersonTable(table) {
  const sb = getSupabaseClient()
  if (!sb || !isSupabaseConfigured()) return []
  const { data, error } = await sb.from(table).select('*').order('created_at', { ascending: false })
  if (error) {
    console.warn(`[entityContactsRepository] fetch ${table}`, error.message)
    return []
  }
  return (data || []).map(normalizePersonRow).filter((r) => r?.name)
}

export async function fetchCustomersFromSupabase() {
  return fetchPersonTable('customers')
}

export async function fetchEmployeesFromSupabase() {
  return fetchPersonTable('employees')
}

export async function fetchSuppliersFromSupabase() {
  return fetchPersonTable('suppliers')
}

export async function insertSupplierSupabase(payload) {
  return insertPerson('suppliers', payload)
}

export async function insertCustomerSupabase(payload) {
  return insertPerson('customers', payload)
}

export async function insertEmployeeSupabase(payload) {
  return insertPerson('employees', payload)
}

/** Gộp danh sách (ưu tiên thứ tự `remote` trước), tránh trùng cặp (phone + name). */
export function mergeCustomerListsDedupe(remote, local) {
  const seen = new Set()
  const out = []
  const keyOf = (c) =>
    `${String(c.phone || '').trim().toLowerCase()}|${String(c.name || '').trim().toLowerCase()}`
  for (const r of remote || []) {
    const k = keyOf(r)
    if (!String(r?.name || '').trim() || seen.has(k)) continue
    seen.add(k)
    out.push({
      name: String(r.name || '').trim(),
      phone: String(r.phone || '').trim(),
      address: String(r.address || '').trim(),
      cccd: String(r.cccd || '').trim(),
      mail: String(r.mail || '').trim(),
    })
  }
  for (const l of local || []) {
    const k = keyOf(l)
    if (!String(l?.name || '').trim() || seen.has(k)) continue
    seen.add(k)
    out.push({
      name: String(l.name || '').trim(),
      phone: String(l.phone || '').trim(),
      address: String(l.address || '').trim(),
      cccd: String(l.cccd || '').trim(),
      mail: String(l.mail || '').trim(),
    })
  }
  return out
}

function fallbackSupplierRowId() {
  return `sup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Gộp nhà cung cấp (ưu tiên `remote`), tránh trùng cặp (phone + name). Giữ `id` từ remote hoặc local.
 * @param {Array} remote
 * @param {Array} local
 * @returns {Array<{ id: string, name: string, phone: string, address: string, cccd: string, mail: string }>}
 */
export function mergeSupplierListsDedupe(remote, local) {
  const seen = new Set()
  const out = []
  const keyOf = (c) =>
    `${String(c.phone || '').trim().toLowerCase()}|${String(c.name || '').trim().toLowerCase()}`
  for (const r of remote || []) {
    const k = keyOf(r)
    if (!String(r?.name || '').trim() || seen.has(k)) continue
    seen.add(k)
    out.push({
      id: String(r.id || '').trim() || fallbackSupplierRowId(),
      name: String(r.name || '').trim(),
      phone: String(r.phone || '').trim(),
      address: String(r.address || '').trim(),
      cccd: String(r.cccd || '').trim(),
      mail: String(r.mail || '').trim(),
    })
  }
  for (const l of local || []) {
    const k = keyOf(l)
    if (!String(l?.name || '').trim() || seen.has(k)) continue
    seen.add(k)
    out.push({
      id: String(l.id || '').trim() || fallbackSupplierRowId(),
      name: String(l.name || '').trim(),
      phone: String(l.phone || '').trim(),
      address: String(l.address || '').trim(),
      cccd: String(l.cccd || '').trim(),
      mail: String(l.mail || '').trim(),
    })
  }
  return out
}

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
  const { data, error } = await sb.from(table).insert(row).select('*').single()
  if (error) return { ok: false, error }
  return { ok: true, row: normalizePersonRow(data) }
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

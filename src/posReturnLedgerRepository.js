/**
 * Hoàn trả POS — `public.pos_return_ledger` (đồng bộ Supabase, không chỉ localStorage).
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { stripUndefinedDeep } from './supabaseInboundHistory.js'
import { loadPosReturnDayLedger, savePosReturnDayLedger } from './posReturnDayLedger.js'

export const POS_RETURN_LEDGER_TABLE = 'pos_return_ledger'
export const POS_RETURN_LEDGER_BUMP_EVENT = 'csv-preview-pos-return-ledger-bump-v1'

export function bumpPosReturnLedgerSync() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(POS_RETURN_LEDGER_BUMP_EVENT))
}

const LOCAL_RETURN_MIGRATE_FLAG = 'csv-preview-pos-return-ledger-migrated-v1'

/** Đẩy phiếu trả cũ (chỉ localStorage trên PC) lên Supabase một lần. */
export async function migrateLocalPosReturnLedgerToSupabaseOnce() {
  if (!isSupabaseConfigured()) return
  try {
    if (sessionStorage.getItem(LOCAL_RETURN_MIGRATE_FLAG) === '1') return
  } catch {
    return
  }
  const local = loadPosReturnDayLedger()
  if (!local.length) {
    try {
      sessionStorage.setItem(LOCAL_RETURN_MIGRATE_FLAG, '1')
    } catch {
      /* ignore */
    }
    return
  }
  const remote = await fetchPosReturnLedgerEntries()
  if (remote.ok && Array.isArray(remote.entries) && remote.entries.length > 0) {
    try {
      sessionStorage.setItem(LOCAL_RETURN_MIGRATE_FLAG, '1')
    } catch {
      /* ignore */
    }
    return
  }
  for (const e of local) {
    const ins = await insertPosReturnLedgerEntry({
      id: e.id,
      atMs: e.atMs,
      orderId: e.orderId,
      revenueSub: e.revenueSub,
      costSub: e.costSub,
      sourceInvoiceNo: e.sourceInvoiceNo,
      lines: e.lines,
    })
    if (!ins.ok) {
      console.error('[posReturnLedger] migrate local entry failed', e?.id, ins.error)
      return
    }
  }
  try {
    sessionStorage.setItem(LOCAL_RETURN_MIGRATE_FLAG, '1')
  } catch {
    /* ignore */
  }
  bumpPosReturnLedgerSync()
}

function newLedgerEntryId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ret-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeLedgerEntryFromPayload(row) {
  if (!row || typeof row !== 'object') return null
  const p = row.payload && typeof row.payload === 'object' ? row.payload : row
  const atMs =
    p.atMs != null && Number.isFinite(Number(p.atMs))
      ? Number(p.atMs)
      : row.created_at
        ? new Date(row.created_at).getTime()
        : Date.now()
  const revenueSub = Number(p.revenueSub)
  const costSub = Number(p.costSub)
  const profitSubRaw = Number(p.profitSub)
  const profitSub = Number.isFinite(profitSubRaw)
    ? Math.max(0, profitSubRaw)
    : Math.max(0, revenueSub - costSub)
  if (!Number.isFinite(atMs) || !Number.isFinite(revenueSub) || !Number.isFinite(costSub)) {
    return null
  }
  const id = String(p.id ?? row.id ?? '').trim() || newLedgerEntryId()
  return {
    id,
    atMs,
    orderId: String(p.orderId ?? row.order_id ?? '').trim(),
    revenueSub,
    costSub,
    profitSub,
    sourceInvoiceNo: String(p.sourceInvoiceNo ?? '').trim(),
    lines: Array.isArray(p.lines) ? p.lines : [],
  }
}

/**
 * @param {{
 *   atMs: number,
 *   orderId: string,
 *   revenueSub: number,
 *   costSub: number,
 *   sourceInvoiceNo?: string,
 *   lines?: object[],
 *   id?: string,
 * }} entry
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown, entry?: object }>}
 */
export async function insertPosReturnLedgerEntry(entry) {
  const revenueSub = Math.max(0, Number(entry.revenueSub) || 0)
  const costSub = Math.max(0, Number(entry.costSub) || 0)
  const profitSubExplicit = Number(entry.profitSub)
  const profitSub = Number.isFinite(profitSubExplicit)
    ? Math.max(0, profitSubExplicit)
    : Math.max(0, revenueSub - costSub)
  const payload = stripUndefinedDeep({
    atMs: entry.atMs,
    orderId: String(entry.orderId || '').trim(),
    revenueSub,
    costSub,
    profitSub,
    sourceInvoiceNo: String(entry.sourceInvoiceNo || '').trim(),
    lines: Array.isArray(entry.lines) ? entry.lines : [],
  })
  const order_id = payload.orderId
  if (!order_id) {
    const error = new Error('Thiếu orderId đơn gốc khi ghi hoàn trả.')
    console.error('[posReturnLedger] insert', error)
    return { ok: false, error }
  }
  if (!Number.isFinite(payload.atMs)) {
    const error = new Error('Thiếu atMs (thời điểm hoàn trả).')
    console.error('[posReturnLedger] insert', error)
    return { ok: false, error }
  }

  const id = String(entry.id || '').trim() || newLedgerEntryId()
  const fullEntry = { ...payload, id }

  if (!isSupabaseConfigured()) {
    const next = [...loadPosReturnDayLedger(), fullEntry]
    savePosReturnDayLedger(next)
    return { ok: true, skipped: true, entry: fullEntry }
  }

  const sb = getSupabaseClient()
  if (!sb) {
    const error = new Error('Không tạo được Supabase client.')
    console.error('[posReturnLedger] insert', error)
    return { ok: false, error }
  }

  try {
    const created_at = new Date(payload.atMs).toISOString()
    const insertRow = stripUndefinedDeep({
      id,
      order_id,
      created_at,
      payload: fullEntry,
    })
    const { data, error } = await sb
      .from(POS_RETURN_LEDGER_TABLE)
      .insert(insertRow)
      .select('id, created_at, order_id, payload')
      .single()

    if (error) {
      console.error('[posReturnLedger] insert Supabase', error)
      return { ok: false, error }
    }

    const persisted = normalizeLedgerEntryFromPayload(data) || fullEntry
    try {
      const local = loadPosReturnDayLedger().filter((e) => String(e?.id) !== String(persisted.id))
      savePosReturnDayLedger([...local, persisted])
    } catch (e) {
      console.warn('[posReturnLedger] mirror local cache', e)
    }
    bumpPosReturnLedgerSync()
    return { ok: true, entry: persisted }
  } catch (error) {
    console.error('[posReturnLedger] insert', error)
    return { ok: false, error }
  }
}

/**
 * Đọc toàn bộ phiếu hoàn trả từ Supabase (mới nhất trước).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown, entries?: object[] }>}
 */
export async function fetchPosReturnLedgerEntries() {
  if (!isSupabaseConfigured()) {
    return { ok: true, skipped: true, entries: loadPosReturnDayLedger() }
  }
  const sb = getSupabaseClient()
  if (!sb) {
    const error = new Error('Không tạo được Supabase client.')
    return { ok: false, error }
  }
  try {
    const { data, error } = await sb
      .from(POS_RETURN_LEDGER_TABLE)
      .select('id, created_at, order_id, payload')
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) {
      console.error('[posReturnLedger] fetch', error)
      return { ok: false, error }
    }
    const entries = (data || [])
      .map((row) => normalizeLedgerEntryFromPayload(row))
      .filter(Boolean)
    return { ok: true, entries }
  } catch (error) {
    console.error('[posReturnLedger] fetch', error)
    return { ok: false, error }
  }
}

/**
 * Xóa toàn bộ phiếu hoàn trả theo `order_id` đơn gốc.
 * @param {string} orderIdRaw
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown }>}
 */
export async function deletePosReturnLedgerByOrderId(orderIdRaw) {
  const orderId = String(orderIdRaw || '').trim()
  if (!orderId) {
    return { ok: false, error: new Error('Thiếu orderId khi xóa phiếu hoàn trả.') }
  }

  if (!isSupabaseConfigured()) {
    try {
      const next = loadPosReturnDayLedger().filter((e) => String(e?.orderId || '').trim() !== orderId)
      savePosReturnDayLedger(next)
      bumpPosReturnLedgerSync()
      return { ok: true, skipped: true }
    } catch (error) {
      return { ok: false, error }
    }
  }

  const sb = getSupabaseClient()
  if (!sb) {
    return { ok: false, error: new Error('Không tạo được Supabase client.') }
  }

  try {
    const { error } = await sb.from(POS_RETURN_LEDGER_TABLE).delete().eq('order_id', orderId)
    if (error) {
      return { ok: false, error }
    }
    try {
      const local = loadPosReturnDayLedger().filter((e) => String(e?.orderId || '').trim() !== orderId)
      savePosReturnDayLedger(local)
    } catch {
      /* ignore local mirror errors */
    }
    bumpPosReturnLedgerSync()
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

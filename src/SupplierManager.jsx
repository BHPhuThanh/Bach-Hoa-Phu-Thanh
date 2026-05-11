import { useCallback, useEffect, useMemo, useState } from 'react'
import EntityPersonModal from './EntityPersonModal.jsx'
import {
  formatPostgrestErrorForUser,
  insertSupplierSupabase,
  updateSupplierSupabase,
} from './entityContactsRepository.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import './adminHub.css'

function normalizeSupplierRow(row) {
  if (!row) return null
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? '').trim(),
    phone: String(row.phone ?? '').trim(),
    address: String(row.address ?? '').trim(),
    cccd: String(row.cccd ?? '').trim(),
    mail: String(row.mail ?? '').trim(),
  }
}

function localFallbackSupplierId() {
  return `ncc-local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Tab «Nhà cung cấp» — tách khỏi Nhập hàng. Fetch một lần khi mount (tab được chọn lần đầu).
 */
export default function SupplierManager({ revenueReadOnly = false }) {
  const [suppliers, setSuppliers] = useState([])
  const [fetchPhase, setFetchPhase] = useState('idle')
  const [searchQ, setSearchQ] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [modalSaving, setModalSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFetchPhase('loading')
      const sb = getSupabaseClient()
      if (!sb || !isSupabaseConfigured()) {
        if (!cancelled) {
          setSuppliers([])
          setFetchPhase('done')
        }
        return
      }
      const { data, error } = await sb.from('suppliers').select('*').order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.warn('[SupplierManager] fetch suppliers', error.message)
        setSuppliers([])
        setFetchPhase('error')
        return
      }
      const rows = (data || []).map(normalizeSupplierRow).filter((r) => r?.name)
      setSuppliers(rows)
      setFetchPhase('done')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = String(searchQ || '')
      .trim()
      .toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((r) => {
      const name = String(r.name || '')
        .toLowerCase()
      const phone = String(r.phone || '').toLowerCase()
      return name.includes(q) || phone.includes(q)
    })
  }, [suppliers, searchQ])

  const openAdd = useCallback(() => {
    if (revenueReadOnly) return
    setEditingSupplier(null)
    setModalOpen(true)
  }, [revenueReadOnly])

  const openEdit = useCallback(
    (row) => {
      if (revenueReadOnly) return
      setEditingSupplier(row)
      setModalOpen(true)
    },
    [revenueReadOnly]
  )

  const closeModal = useCallback(() => {
    if (modalSaving) return
    setModalOpen(false)
    setEditingSupplier(null)
  }, [modalSaving])

  const handleSubmit = useCallback(
    async (draft) => {
      if (revenueReadOnly) return
      const name = String(draft?.name || '').trim()
      if (!name) {
        window.alert('Nhập tên nhà cung cấp.')
        return
      }
      setModalSaving(true)
      try {
        const payload = {
          name,
          phone: String(draft?.phone || '').trim(),
          address: String(draft?.address || '').trim(),
          cccd: String(draft?.cccd || '').trim(),
          mail: String(draft?.mail || '').trim(),
        }
        const editId = editingSupplier?.id ? String(editingSupplier.id).trim() : ''
        if (editId) {
          const up = await updateSupplierSupabase(editId, payload)
          if (!up.ok && !up.skipped) {
            window.alert(formatPostgrestErrorForUser(up.error))
            return
          }
          if (up.ok && up.row) {
            setSuppliers((prev) => prev.map((r) => (String(r.id) === String(up.row.id) ? up.row : r)))
          } else if (up.skipped) {
            setSuppliers((prev) =>
              prev.map((r) => (String(r.id) === editId ? { ...r, ...payload, id: r.id } : r))
            )
          }
          setModalOpen(false)
          setEditingSupplier(null)
          return
        }

        const ins = await insertSupplierSupabase(payload)
        if (!ins.ok && !ins.skipped) {
          window.alert(formatPostgrestErrorForUser(ins.error))
          return
        }
        if (ins.ok && ins.row?.id) {
          setSuppliers((prev) => [normalizeSupplierRow(ins.row), ...prev])
        } else if (ins.skipped) {
          setSuppliers((prev) => [
            {
              id: localFallbackSupplierId(),
              ...payload,
            },
            ...prev,
          ])
        }
        setModalOpen(false)
        setEditingSupplier(null)
      } catch (e) {
        window.alert(formatPostgrestErrorForUser(e))
      } finally {
        setModalSaving(false)
      }
    },
    [revenueReadOnly, editingSupplier]
  )

  const modalSeed = useMemo(() => {
    if (!editingSupplier) return null
    return {
      name: editingSupplier.name,
      phone: editingSupplier.phone,
      address: editingSupplier.address,
      cccd: editingSupplier.cccd,
      mail: editingSupplier.mail,
    }
  }, [editingSupplier])

  const showLoading = fetchPhase === 'loading' && isSupabaseConfigured()

  return (
    <section aria-labelledby="ah-supplier-title">
      <h2 id="ah-supplier-title" className="admin-hub-panel-title">
        Nhà cung cấp
      </h2>
      <div className="admin-hub-toolbar ah-hub-toolbar-split">
        <input
          className="admin-hub-search ah-hub-toolbar-search"
          type="search"
          placeholder="Tìm theo tên hoặc số điện thoại…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="ah-hub-add-entity-btn"
          onClick={openAdd}
          disabled={revenueReadOnly}
          title={revenueReadOnly ? 'Chỉ Admin' : 'Thêm nhà cung cấp'}
        >
          + Thêm NCC
        </button>
      </div>
      <div className="admin-hub-table-wrap">
        <table className="admin-hub-table">
          <thead>
            <tr>
              <th>Mã NCC</th>
              <th>Tên nhà cung cấp</th>
              <th>Điện thoại</th>
              <th>Địa chỉ</th>
              <th>CCCD</th>
              <th>Mail</th>
            </tr>
          </thead>
          <tbody>
            {showLoading ? (
              <tr>
                <td colSpan={6} className="admin-hub-muted">
                  Đang tải danh sách từ Supabase…
                </td>
              </tr>
            ) : fetchPhase === 'error' ? (
              <tr>
                <td colSpan={6} className="admin-hub-muted">
                  Không tải được danh sách. Kiểm tra kết nối hoặc quyền đọc bảng «suppliers».
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-hub-muted">
                  {!isSupabaseConfigured()
                    ? 'Chưa cấu hình Supabase — không có dữ liệu từ máy chủ.'
                    : suppliers.length === 0
                      ? 'Chưa có nhà cung cấp — thêm mới hoặc kiểm tra bảng trên Supabase.'
                      : 'Không có dòng khớp tìm kiếm.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="admin-hub-muted" style={{ fontSize: '0.9em' }}>
                    {r.id || '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ah-inbound-code-link"
                      onClick={() => openEdit(r)}
                      disabled={revenueReadOnly}
                      title={revenueReadOnly ? 'Chỉ Admin' : 'Sửa nhà cung cấp'}
                    >
                      {r.name || '—'}
                    </button>
                  </td>
                  <td>{r.phone || '—'}</td>
                  <td>{r.address || '—'}</td>
                  <td>{r.cccd || '—'}</td>
                  <td>{r.mail || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <EntityPersonModal
        open={modalOpen}
        title={editingSupplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
        saveLabel={editingSupplier ? 'Lưu thay đổi' : 'Lưu NCC'}
        isSaving={modalSaving}
        seedDraft={modalSeed}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import EntityPersonModal from './EntityPersonModal.jsx'
import {
  formatPostgrestErrorForUser,
  deleteSupplierSupabase,
  insertSupplierSupabase,
  updateSupplierSupabase,
} from './entityContactsRepository.js'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { useViewportMaxWidth } from './useViewportMaxWidth.js'
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
export default function SupplierManager({ revenueReadOnly = false, onSupplierCreated }) {
  const isMobileLayout = useViewportMaxWidth(768)
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
      if (!supabase || !isSupabaseConfigured()) {
        if (!cancelled) {
          setSuppliers([])
          setFetchPhase('done')
        }
        return
      }
      const { data, error } = await supabase.from('suppliers').select('*')
      if (cancelled) return
      if (error) {
        console.error('[SupplierManager] fetch suppliers', error)
        setSuppliers([])
        setFetchPhase('error')
        return
      }
      const rows = (Array.isArray(data) ? data : []).map(normalizeSupplierRow).filter((r) => r?.name)
      setSuppliers(rows)
      setFetchPhase('done')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const list = Array.isArray(suppliers) ? suppliers : []
    const q = String(searchQ || '')
      .trim()
      .toLowerCase()
    return list.filter((r) => {
      if (!q) return true
      return (r?.name || '').toLowerCase().includes(q)
    })
  }, [searchQ, suppliers])

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

  const handleDeleteSupplier = useCallback(
    async (row) => {
      if (revenueReadOnly || !row) return
      const name = String(row.name || '').trim() || 'nhà cung cấp này'
      if (
        !window.confirm(`Sếp có chắc chắn muốn xóa nhà cung cấp này không?\n\n${name}`)
      ) {
        return
      }
      const id = String(row.id ?? '').trim()
      if (id) {
        const del = await deleteSupplierSupabase(id)
        if (!del.ok && !del.skipped) {
          window.alert(formatPostgrestErrorForUser(del.error))
          return
        }
      }
      setSuppliers((prev) => prev.filter((r) => String(r.id) !== id))
    },
    [revenueReadOnly]
  )

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
          const created = normalizeSupplierRow(ins.row)
          setSuppliers((prev) => [created, ...prev])
          await Promise.resolve(onSupplierCreated?.(created))
        } else if (ins.skipped) {
          const created = {
            id: localFallbackSupplierId(),
            ...payload,
          }
          setSuppliers((prev) => [
            created,
            ...prev,
          ])
          await Promise.resolve(onSupplierCreated?.(created))
        }
        setModalOpen(false)
        setEditingSupplier(null)
      } catch (e) {
        window.alert(formatPostgrestErrorForUser(e))
      } finally {
        setModalSaving(false)
      }
    },
    [revenueReadOnly, editingSupplier, onSupplierCreated]
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
      <div className="admin-hub-table-wrap ah-supplier-table-wrap">
        {showLoading ? (
          <table className="admin-hub-table ah-supplier-status-table">
            <tbody>
              <tr>
                <td colSpan={6} className="admin-hub-muted">
                  Đang tải danh sách từ Supabase…
                </td>
              </tr>
            </tbody>
          </table>
        ) : fetchPhase === 'error' ? (
          <table className="admin-hub-table ah-supplier-status-table">
            <tbody>
              <tr>
                <td colSpan={6} className="admin-hub-muted">
                  Không tải được danh sách. Kiểm tra kết nối hoặc quyền đọc bảng «suppliers».
                </td>
              </tr>
            </tbody>
          </table>
        ) : filtered.length === 0 ? (
          <table className="admin-hub-table ah-supplier-status-table">
            <tbody>
              <tr>
                <td colSpan={6} className="admin-hub-muted">
                  {!isSupabaseConfigured()
                    ? 'Chưa cấu hình Supabase — không có dữ liệu từ máy chủ.'
                    : (Array.isArray(suppliers) ? suppliers.length : 0) === 0
                      ? 'Chưa có nhà cung cấp — thêm mới hoặc kiểm tra bảng trên Supabase.'
                      : 'Không có dòng khớp tìm kiếm.'}
                </td>
              </tr>
            </tbody>
          </table>
        ) : isMobileLayout ? (
          <div className="ah-hub-entity-mobile-list">
            {filtered.map((r, idx) => {
              const row = r && typeof r === 'object' ? r : {}
              const idLabel = String(row.id ?? '').trim() || `row-${idx + 1}`
              const nameLabel = String(row.name ?? '').trim() || '—'
              const phoneLabel = String(row.phone ?? '').trim() || '—'
              const mailLabel = String(row.mail ?? '').trim() || '—'
              const addressLabel = String(row.address ?? '').trim()
              const cccdLabel = String(row.cccd ?? '').trim()
              return (
              <div key={idLabel} className="ah-hub-entity-mobile-card ah-supplier-virt-card">
                <div className="ah-supplier-virt-card-top">
                  <span className="ah-supplier-virt-id">{idLabel}</span>
                  <div className="ah-supplier-virt-card-actions">
                    <button
                      type="button"
                      className="ah-inbound-code-link ah-supplier-virt-name-btn"
                      onClick={() => openEdit(row)}
                      disabled={revenueReadOnly}
                    >
                      {nameLabel}
                    </button>
                    {!revenueReadOnly ? (
                      <button
                        type="button"
                        className="ah-hub-entity-delete-btn"
                        onClick={() => void handleDeleteSupplier(row)}
                        title="Xóa nhà cung cấp"
                      >
                        Xóa
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="ah-supplier-virt-meta">
                  <span>{phoneLabel}</span>
                  <span className="ah-supplier-virt-meta-sep">·</span>
                  <span>{mailLabel}</span>
                </div>
                {addressLabel ? <div className="ah-supplier-virt-addr">{addressLabel}</div> : null}
                {cccdLabel ? (
                  <div className="ah-hub-entity-mobile-card-extra">CCCD: {cccdLabel}</div>
                ) : null}
              </div>
            )})}
          </div>
        ) : (
          <table className="admin-hub-table ah-supplier-data-table">
            <thead>
              <tr>
                <th>Mã NCC</th>
                <th>Tên nhà cung cấp</th>
                <th>Điện thoại</th>
                <th>Địa chỉ</th>
                <th>CCCD</th>
                <th>Mail</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const row = r && typeof r === 'object' ? r : {}
                const idLabel = String(row.id ?? '').trim() || `row-${idx + 1}`
                const nameLabel = String(row.name ?? '').trim() || '—'
                const phoneLabel = String(row.phone ?? '').trim() || '—'
                const addressLabel = String(row.address ?? '').trim() || '—'
                const cccdLabel = String(row.cccd ?? '').trim() || '—'
                const mailLabel = String(row.mail ?? '').trim() || '—'
                return (
                <tr key={idLabel}>
                  <td className="admin-hub-muted" style={{ fontSize: '0.9em' }}>
                    {idLabel}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ah-inbound-code-link"
                      onClick={() => openEdit(row)}
                      disabled={revenueReadOnly}
                      title={revenueReadOnly ? 'Chỉ Admin' : 'Sửa nhà cung cấp'}
                    >
                      {nameLabel}
                    </button>
                  </td>
                  <td>{phoneLabel}</td>
                  <td>{addressLabel}</td>
                  <td>{cccdLabel}</td>
                  <td>{mailLabel}</td>
                  <td>
                    {!revenueReadOnly ? (
                      <button
                        type="button"
                        className="ah-hub-entity-delete-btn"
                        onClick={() => void handleDeleteSupplier(row)}
                        title="Xóa nhà cung cấp"
                      >
                        Xóa
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        )}
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

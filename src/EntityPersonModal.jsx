import { useEffect, useState } from 'react'

const EMPTY = { name: '', phone: '', address: '', cccd: '', mail: '' }

/**
 * Modal tái sử dụng — form giống «Thêm nhà cung cấp»: Tên, SĐT, Địa chỉ, CCCD, Mail.
 */
export default function EntityPersonModal({
  open,
  title,
  saveLabel = 'Lưu',
  isSaving = false,
  onClose,
  onSubmit,
  /** Tiền điền khi mở (sửa). Không truyền hoặc `null` = form trống (thêm mới). */
  seedDraft = null,
}) {
  const [draft, setDraft] = useState(EMPTY)

  useEffect(() => {
    if (!open) return
    if (seedDraft != null && typeof seedDraft === 'object') {
      setDraft({
        name: String(seedDraft.name ?? ''),
        phone: String(seedDraft.phone ?? ''),
        address: String(seedDraft.address ?? ''),
        cccd: String(seedDraft.cccd ?? ''),
        mail: String(seedDraft.mail ?? ''),
      })
    } else {
      setDraft({ ...EMPTY })
    }
  }, [open, seedDraft])

  if (!open) return null

  const stopKeyFromReachingAncestors = (e) => {
    e.stopPropagation()
  }

  const submit = () => {
    if (isSaving) return
    onSubmit({ ...draft })
  }

  return (
    <div
      className="ah-inbound-sup-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose?.()
      }}
    >
      <div
        className="ah-inbound-sup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-person-modal-title"
        aria-busy={isSaving}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="entity-person-modal-title" className="ah-inbound-sup-title">
          {title}
        </h3>
        <label className="ah-inbound-sup-field">
          <span>Tên</span>
          <input
            type="text"
            className="ah-inbound-form-input"
            value={draft.name}
            onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
            onKeyDown={stopKeyFromReachingAncestors}
            autoComplete="name"
            autoFocus
            disabled={isSaving}
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>Số điện thoại</span>
          <input
            type="tel"
            className="ah-inbound-form-input"
            value={draft.phone}
            onChange={(e) => setDraft((s) => ({ ...s, phone: e.target.value }))}
            onKeyDown={stopKeyFromReachingAncestors}
            autoComplete="tel"
            disabled={isSaving}
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>Địa chỉ</span>
          <input
            type="text"
            className="ah-inbound-form-input"
            value={draft.address}
            onChange={(e) => setDraft((s) => ({ ...s, address: e.target.value }))}
            onKeyDown={stopKeyFromReachingAncestors}
            autoComplete="street-address"
            disabled={isSaving}
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>CCCD</span>
          <input
            type="text"
            className="ah-inbound-form-input"
            value={draft.cccd}
            onChange={(e) => setDraft((s) => ({ ...s, cccd: e.target.value }))}
            onKeyDown={stopKeyFromReachingAncestors}
            autoComplete="off"
            disabled={isSaving}
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>Mail</span>
          <input
            type="email"
            className="ah-inbound-form-input"
            value={draft.mail}
            onChange={(e) => setDraft((s) => ({ ...s, mail: e.target.value }))}
            onKeyDown={stopKeyFromReachingAncestors}
            autoComplete="email"
            disabled={isSaving}
          />
        </label>
        <div className="ah-inbound-sup-actions">
          <button
            type="button"
            className="ah-inbound-footer-btn ah-inbound-footer-btn--ghost"
            disabled={isSaving}
            onClick={() => onClose?.()}
          >
            Hủy
          </button>
          <button
            type="button"
            className="ah-inbound-footer-btn ah-inbound-footer-btn--done ah-entity-save-btn"
            disabled={isSaving}
            onClick={submit}
          >
            {isSaving ? (
              <>
                <span className="ah-entity-spinner" aria-hidden />
                Đang lưu…
              </>
            ) : (
              saveLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

const EMPTY = { name: '', phone: '', address: '', cccd: '', mail: '' }

/**
 * Modal tái sử dụng — form giống «Thêm nhà cung cấp»: Tên, SĐT, Địa chỉ, CCCD, Mail.
 */
export default function EntityPersonModal({
  open,
  title,
  saveLabel = 'Lưu',
  onClose,
  onSubmit,
}) {
  const [draft, setDraft] = useState(EMPTY)

  useEffect(() => {
    if (open) setDraft(EMPTY)
  }, [open])

  if (!open) return null

  const submit = () => {
    onSubmit({ ...draft })
  }

  return (
    <div
      className="ah-inbound-sup-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="ah-inbound-sup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-person-modal-title"
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
            autoComplete="name"
            autoFocus
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>Số điện thoại</span>
          <input
            type="tel"
            className="ah-inbound-form-input"
            value={draft.phone}
            onChange={(e) => setDraft((s) => ({ ...s, phone: e.target.value }))}
            autoComplete="tel"
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>Địa chỉ</span>
          <input
            type="text"
            className="ah-inbound-form-input"
            value={draft.address}
            onChange={(e) => setDraft((s) => ({ ...s, address: e.target.value }))}
            autoComplete="street-address"
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>CCCD</span>
          <input
            type="text"
            className="ah-inbound-form-input"
            value={draft.cccd}
            onChange={(e) => setDraft((s) => ({ ...s, cccd: e.target.value }))}
            autoComplete="off"
          />
        </label>
        <label className="ah-inbound-sup-field">
          <span>Mail</span>
          <input
            type="email"
            className="ah-inbound-form-input"
            value={draft.mail}
            onChange={(e) => setDraft((s) => ({ ...s, mail: e.target.value }))}
            autoComplete="email"
          />
        </label>
        <div className="ah-inbound-sup-actions">
          <button type="button" className="ah-inbound-footer-btn ah-inbound-footer-btn--ghost" onClick={() => onClose?.()}>
            Hủy
          </button>
          <button type="button" className="ah-inbound-footer-btn ah-inbound-footer-btn--done" onClick={submit}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

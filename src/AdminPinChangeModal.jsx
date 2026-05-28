import { useMemo, useState } from 'react'

function normalizeDigits(raw) {
  return String(raw ?? '').replace(/\D/g, '')
}

function PasswordField({ id, label, value, onChange, visible, onToggle, disabled = false }) {
  return (
    <label className="ah-inbound-sup-field" htmlFor={id}>
      <span>{label}</span>
      <div className="ah-admin-pin-input-row">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="ah-inbound-form-input"
          value={value}
          onChange={(e) => onChange(normalizeDigits(e.target.value))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          disabled={disabled}
        />
        <button
          type="button"
          className="ah-admin-pin-eye-btn"
          onClick={onToggle}
          disabled={disabled}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </label>
  )
}

export default function AdminPinChangeModal({ open, onClose, onSubmit, isSubmitting = false }) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const validationMsg = useMemo(() => {
    if (!currentPin || !newPin || !confirmPin) return 'Vui lòng nhập đủ 3 ô.'
    if (newPin !== confirmPin) return 'Mật khẩu mới và xác nhận chưa khớp.'
    return ''
  }, [currentPin, newPin, confirmPin])

  if (!open) return null

  const submit = () => {
    if (isSubmitting) return
    if (validationMsg) return
    onSubmit?.({ currentPin, newPin, confirmPin })
  }

  return (
    <div
      className="ah-inbound-sup-backdrop ah-admin-pin-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose?.()
      }}
    >
      <div
        className="ah-inbound-sup-modal ah-admin-pin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-pin-change-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="admin-pin-change-modal-title" className="ah-inbound-sup-title">
          Đổi mật khẩu Admin
        </h3>
        <PasswordField
          id="admin-pin-current"
          label="Mật khẩu hiện tại"
          value={currentPin}
          onChange={setCurrentPin}
          visible={showCurrent}
          onToggle={() => setShowCurrent((v) => !v)}
          disabled={isSubmitting}
        />
        <PasswordField
          id="admin-pin-new"
          label="Mật khẩu mới"
          value={newPin}
          onChange={setNewPin}
          visible={showNew}
          onToggle={() => setShowNew((v) => !v)}
          disabled={isSubmitting}
        />
        <PasswordField
          id="admin-pin-confirm"
          label="Xác nhận mật khẩu mới"
          value={confirmPin}
          onChange={setConfirmPin}
          visible={showConfirm}
          onToggle={() => setShowConfirm((v) => !v)}
          disabled={isSubmitting}
        />
        {validationMsg ? (
          <p className="ah-admin-pin-error" role="alert">
            {validationMsg}
          </p>
        ) : null}
        <div className="ah-inbound-sup-actions">
          <button
            type="button"
            className="ah-inbound-footer-btn ah-inbound-footer-btn--ghost"
            disabled={isSubmitting}
            onClick={() => onClose?.()}
          >
            Hủy
          </button>
          <button
            type="button"
            className="ah-inbound-footer-btn ah-inbound-footer-btn--done"
            disabled={Boolean(validationMsg) || isSubmitting}
            onClick={submit}
          >
            {isSubmitting ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

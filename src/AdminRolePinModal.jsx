import { useEffect, useState } from 'react'

/**
 * Xác nhận PIN khi chuyển từ Nhân viên → Admin trên POS.
 * PIN: `VITE_ADMIN_ROLE_PIN` (mặc định 1234 nếu không cấu hình).
 */
export default function AdminRolePinModal({ open, onClose, onVerified }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setPin('')
    setError('')
  }, [open])

  if (!open) return null

  const submit = () => {
    const expected = String(import.meta.env.VITE_ADMIN_ROLE_PIN ?? '1234').trim()
    if (pin.trim() !== expected) {
      setError('Mật khẩu không đúng.')
      return
    }
    onVerified?.()
  }

  return (
    <div
      className="ah-inbound-sup-backdrop ah-admin-pin-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="ah-inbound-sup-modal ah-admin-pin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-pin-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="admin-pin-modal-title" className="ah-inbound-sup-title">
          Xác nhận quyền Admin
        </h3>
        <p className="ah-admin-pin-hint">
          Nhập mật khẩu (PIN) để chuyển sang tài khoản Admin — Chủ cửa hàng.
        </p>
        <label className="ah-inbound-sup-field">
          <span>Mật khẩu</span>
          <input
            type="password"
            className="ah-inbound-form-input"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            autoComplete="off"
            autoFocus
            inputMode="numeric"
          />
        </label>
        {error ? (
          <p className="ah-admin-pin-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ah-inbound-sup-actions">
          <button
            type="button"
            className="ah-inbound-footer-btn ah-inbound-footer-btn--ghost"
            onClick={() => onClose?.()}
          >
            Hủy
          </button>
          <button
            type="button"
            className="ah-inbound-footer-btn ah-inbound-footer-btn--done"
            onClick={submit}
          >
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  )
}

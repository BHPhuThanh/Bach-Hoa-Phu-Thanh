import { useEffect, useState } from 'react'

/**
 * Xác nhận PIN khi chuyển từ Nhân viên → Admin trên POS.
 * PIN: `VITE_ADMIN_ROLE_PIN` (mặc định 1234 nếu không cấu hình).
 */
export default function AdminRolePinModal({ open, onClose, onVerified, onInvalidPin }) {
  const [pin, setPin] = useState('')

  useEffect(() => {
    if (!open) return
    setPin('')
  }, [open])

  if (!open) return null

  const submit = () => {
    const expected = String(import.meta.env.VITE_ADMIN_ROLE_PIN ?? '1234').trim()
    if (pin.trim() !== expected) {
      onInvalidPin?.()
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
              const digitsOnly = String(e.target.value ?? '').replace(/\D/g, '')
              setPin(digitsOnly)
            }}
            onKeyDown={(e) => {
              const allowControl =
                e.key === 'Backspace' ||
                e.key === 'Delete' ||
                e.key === 'Tab' ||
                e.key === 'ArrowLeft' ||
                e.key === 'ArrowRight' ||
                e.key === 'Home' ||
                e.key === 'End'
              if (!allowControl && !/^\d$/.test(e.key)) {
                e.preventDefault()
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            autoComplete="off"
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
          />
        </label>
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

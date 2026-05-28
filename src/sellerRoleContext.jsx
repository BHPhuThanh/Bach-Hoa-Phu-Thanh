import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  POS_ACTIVE_SELLER_STORAGE_KEY,
  readStoredSellerId,
  writeStoredSellerId,
} from './sellerRoleStorage.js'

export const SELLER_ROLE_CHANGED_EVENT = 'csv-preview-seller-role-changed'

const SellerRoleContext = createContext(null)

function normalizeSellerId(id) {
  return id === 'staff' || id === 'admin' ? id : 'admin'
}

export function SellerRoleProvider({ children }) {
  const [sellerId, setSellerIdState] = useState(() => normalizeSellerId(readStoredSellerId() ?? 'admin'))

  const syncFromStorage = useCallback(() => {
    const next = normalizeSellerId(readStoredSellerId() ?? 'admin')
    setSellerIdState((prev) => (prev === next ? prev : next))
  }, [])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.storageArea !== localStorage) return
      if (e.key !== POS_ACTIVE_SELLER_STORAGE_KEY) return
      syncFromStorage()
    }
    const onRoleChanged = () => syncFromStorage()
    window.addEventListener('storage', onStorage)
    window.addEventListener(SELLER_ROLE_CHANGED_EVENT, onRoleChanged)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SELLER_ROLE_CHANGED_EVENT, onRoleChanged)
    }
  }, [syncFromStorage])

  const setSellerId = useCallback((id) => {
    const next = normalizeSellerId(id)
    writeStoredSellerId(next)
    setSellerIdState(next)
  }, [])

  const value = useMemo(
    () => ({
      sellerId,
      isAdmin: sellerId === 'admin',
      setSellerId,
    }),
    [sellerId, setSellerId]
  )

  return <SellerRoleContext.Provider value={value}>{children}</SellerRoleContext.Provider>
}

export function useSellerRole() {
  const ctx = useContext(SellerRoleContext)
  if (!ctx) {
    throw new Error('useSellerRole phải dùng trong SellerRoleProvider')
  }
  return ctx
}

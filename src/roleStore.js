import { useMemo, useSyncExternalStore } from 'react'
import { POS_ACTIVE_SELLER_STORAGE_KEY } from './sellerRoleStorage.js'

function normalizeRole(v) {
  return v === 'staff' || v === 'admin' ? v : 'admin'
}

function readRoleFromStorage() {
  try {
    return normalizeRole(localStorage.getItem(POS_ACTIVE_SELLER_STORAGE_KEY))
  } catch {
    return 'admin'
  }
}

let currentRole = readRoleFromStorage()
const listeners = new Set()

function emit() {
  for (const cb of listeners) cb()
}

export function getRoleSnapshot() {
  return currentRole
}

export function setRole(nextRole) {
  const normalized = normalizeRole(nextRole)
  currentRole = normalized
  try {
    localStorage.setItem(POS_ACTIVE_SELLER_STORAGE_KEY, normalized)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('csv-preview-seller-role-changed'))
  }
  emit()
}

export function subscribeRoleStore(cb) {
  listeners.add(cb)
  const onStorage = (e) => {
    if (e.storageArea !== localStorage) return
    if (e.key !== POS_ACTIVE_SELLER_STORAGE_KEY) return
    currentRole = readRoleFromStorage()
    emit()
  }
  const onChanged = () => {
    currentRole = readRoleFromStorage()
    emit()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('csv-preview-seller-role-changed', onChanged)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('csv-preview-seller-role-changed', onChanged)
  }
}

export function useRoleStore() {
  const role = useSyncExternalStore(subscribeRoleStore, getRoleSnapshot, getRoleSnapshot)
  return useMemo(
    () => ({
      sellerId: role,
      isAdmin: role === 'admin',
      setSellerId: setRole,
    }),
    [role]
  )
}

import { createClient } from '@supabase/supabase-js'

// Lấy trực tiếp từ Vite, không qua trung gian
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabaseReady =
  typeof supabaseUrl === 'string' &&
  supabaseUrl.trim().length > 0 &&
  typeof supabaseAnonKey === 'string' &&
  supabaseAnonKey.trim().length > 0

export const supabase = supabaseReady ? createClient(supabaseUrl, supabaseAnonKey) : null

export const getSupabaseClient = () => supabase
export const isSupabaseConfigured = () => supabaseReady
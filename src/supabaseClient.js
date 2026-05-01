import { createClient } from '@supabase/supabase-js'

// Lấy trực tiếp từ Vite, không qua trung gian
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// In ra để sếp tự kiểm tra (Sếp nhìn Console thấy chữ này là OK)
console.log("APP ĐANG DÙNG URL:", supabaseUrl);
console.log("APP ĐANG DÙNG KEY (5 ký tự đầu):", supabaseAnonKey?.substring(0, 5));

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const getSupabaseClient = () => supabase
export const isSupabaseConfigured = () => !!supabaseUrl && !!supabaseAnonKey
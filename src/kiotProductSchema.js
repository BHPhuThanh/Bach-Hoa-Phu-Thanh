/**
 * Product columns synced with `public.products` (CSV `bhphuthanh.csv`).
 * Dùng chung bootstrap CSV và upsert từ POS — không đổi thứ tự tùy tiện.
 *
 * File `public/bhphuthanh.csv` (dấu `;`): cột 7 = index 6 = «ton_kho»; cột 10 = index 9 = «dvt»; cột 12 = index 11 = «quy_doi».
 */
export const BHPHUTHANH_SEMICOLON_CSV_TON_KHO_INDEX = 6
export const BHPHUTHANH_SEMICOLON_CSV_DVT_INDEX = 9
export const BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX = 11

export const CATALOG_PRODUCT_DB_COLUMNS = [
  'ma_hang',
  'ma_vach',
  'ten_hang',
  'thuong_hieu',
  'gia_ban',
  'gia_von',
  'ton_kho',
  'ton_nho_nhat',
  'ton_lon_nhat',
  'dvt',
  'ma_dvt_co_ban',
  'quy_doi',
  'ma_hh_lien_quan',
  'trong_luong',
  'gia_si',
]

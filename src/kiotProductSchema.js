/**
 * Tên cột thực trên `public.products` (Supabase) — Tiếng Việt có dấu, khớp tiêu đề Excel.
 * Thứ tự giữ nguyên logic cũ (kiotnew / bootstrap).
 */
export const PRODUCT_COL = {
  MA_HANG: 'Mã hàng',
  MA_VACH: 'Mã vạch',
  TEN_HANG: 'Tên hàng',
  THUONG_HIEU: 'Thương hiệu',
  GIA_BAN: 'Giá bán',
  GIA_VON: 'Giá vốn',
  TON_KHO: 'Tồn kho',
  /** Khớp Supabase Table Editor (hai chữ HOA KH). */
  KH_DAT: 'KH đặt',
  DU_KIEN_HET_HANG: 'Dự kiến hết hàng',
  TON_NHO_NHAT: 'Tồn nhỏ nhất',
  TON_LON_NHAT: 'Tồn lớn nhất',
  DVT: 'ĐVT',
  /** Chữ C viết hoa trong «Cơ bản» — khớp cột trên Supabase. */
  MA_DVT_CO_BAN: 'Mã ĐVT Cơ bản',
  QUY_DOI: 'Quy đổi',
  THUOC_TINH: 'Thuộc tính',
  /** Chữ L viết hoa trong «Liên quan». */
  MA_HH_LIEN_QUAN: 'Mã HH Liên quan',
  TRONG_LUONG: 'Trọng lượng',
  DANG_KINH_DOANH: 'Đang kinh doanh',
  DUOC_BAN_TRUC_TIEP: 'Được bán trực tiếp',
  GIA_SI: 'Giá sỉ',
}

/** Cột PK / upsert — trùng khóa trong một request. */
export const PRODUCT_PK_COLUMN = PRODUCT_COL.MA_HANG

export const KIOTNEW_PRODUCT_DB_COLUMNS = [
  PRODUCT_COL.MA_HANG,
  PRODUCT_COL.MA_VACH,
  PRODUCT_COL.TEN_HANG,
  PRODUCT_COL.THUONG_HIEU,
  PRODUCT_COL.GIA_BAN,
  PRODUCT_COL.GIA_VON,
  PRODUCT_COL.TON_KHO,
  PRODUCT_COL.KH_DAT,
  PRODUCT_COL.DU_KIEN_HET_HANG,
  PRODUCT_COL.TON_NHO_NHAT,
  PRODUCT_COL.TON_LON_NHAT,
  PRODUCT_COL.DVT,
  PRODUCT_COL.MA_DVT_CO_BAN,
  PRODUCT_COL.QUY_DOI,
  PRODUCT_COL.THUOC_TINH,
  PRODUCT_COL.MA_HH_LIEN_QUAN,
  PRODUCT_COL.TRONG_LUONG,
  PRODUCT_COL.DANG_KINH_DOANH,
  PRODUCT_COL.DUOC_BAN_TRUC_TIEP,
  PRODUCT_COL.GIA_SI,
]

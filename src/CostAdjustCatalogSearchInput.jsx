/** Ô tìm sản phẩm — dùng chung trang tạo phiếu điều chỉnh giá (form chính + modal Chọn nhanh). */
export default function CostAdjustCatalogSearchInput({
  inputRef,
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder = 'Tìm theo tên, mã SKU, hoặc quét mã Barcode… (F3)',
  id,
  'aria-label': ariaLabel,
}) {
  return (
    <div className="cac-search-wrap">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <input
        id={id}
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel ?? 'Tìm sản phẩm'}
      />
    </div>
  )
}

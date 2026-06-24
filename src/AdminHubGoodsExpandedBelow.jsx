import { AdminHubComboBomPanel } from './AdminHubComboBomPanel.jsx'
import { shouldShowComboBomTab } from './comboBomTabVisible.js'
import { findVariantContext } from './inboundFormUnitHelpers.js'
import { sortVariantsSmallestUnitFirst } from './goodsUnitSetupModalLogic.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'
import InboundThuongHieuAutocomplete from './InboundThuongHieuAutocomplete.jsx'

/** Chi tiết hàng — hiển thị trong ô danh sách ảo (cùng markup tab Hàng hóa). */
export function AdminHubGoodsExpandedBelow(props) {
  const {
    GOODS_DETAIL_VIEW_TONKHO,
    GOODS_DETAIL_VIEW_LICHSU,
    GOODS_DETAIL_VIEW_COMBO,
    goodsDetailShelfTab,
    setGoodsDetailShelfTab,
    discardGoodsDetailDraft,
    saveGoodsDetail,
    v,
    d,
    goodsDetailCtx,
    goodsDetailSelectedVid,
    setGoodsDetailSelectedVid,
    setGoodsDetailDraft,
    buildGoodsDetailDraft,
    copyGoodsDetail,
    deleteGoodsDetailVariant,
    formatMoneyDraftVi,
    goodsStockLedgerMerged = { mode: 'legacy', rows: [] },
    goodsInventoryPreviewRows = [],
    goodsInvLedgerDateFrom = '',
    goodsInvLedgerDateTo = '',
    goodsInvLedgerDocumentSearch = '',
    onGoodsInvLedgerDateFromChange,
    onGoodsInvLedgerDateToChange,
    onGoodsInvLedgerDocumentSearchChange,
    onInventoryDocumentActivate,
    getStockLedgerDetailAbsoluteUrl,
    openGoodsUnitModal,
    catalogList,
    isComboDetail,
    comboDetailProduct,
    onEditComboProduct,
    goodsBrandAutocompleteOptions = [],
    onRequestAddSupplier,
    onRequestBarcodeScan,
    onCloseGoodsDetail,
  } = props
  const glMerged = goodsStockLedgerMerged || { mode: 'legacy', rows: [] }
  const glRows = Array.isArray(glMerged.rows) ? glMerged.rows : []
  const glLoading = glMerged.mode === 'loading'
  const glLegacyEmptyMsg =
    'Chưa có dòng nhật ký trên Supabase cho sản phẩm này (mọi đơn vị tính).'

  return (
    <div className="ah-goods-detail-after-virt" onClick={(e) => e.stopPropagation()}>
                                <div className="ah-goods-detail-panel ah-goods-detail-panel--card">
                                  <div className={`ah-goods-detail-card${onCloseGoodsDetail ? ' ah-goods-detail-card--v2-modal' : ''}`}>
            <div className="ah-goods-detail-sticky-header">
                                    {onCloseGoodsDetail ? (
                                      <div className="ah-goods-detail-mobile-cap">
                                        <div className="ah-goods-detail-mobile-cap__text">
                                          <div className="ah-goods-detail-mobile-cap__name">
                                            {String(d?.name ?? v?.name ?? '').trim() || '—'}
                                          </div>
                                          <div className="ah-goods-detail-mobile-cap__code">
                                            Mã: {String(d?.code ?? v?.code ?? '').trim() || '—'}
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="ah-goods-detail-mobile-cap__close"
                                          aria-label="Đóng chi tiết"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onCloseGoodsDetail()
                                          }}
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ) : null}
                                    <div
                                        className="ah-solo-product-tabs-bar ah-hub-tabstrip--dark ah-goods-detail-tabs-bar"
                                        aria-label="Điều hướng chi tiết hàng"
                                      >
                                        <div className="ah-solo-product-tabstrip" role="tablist">
                                          <button
                                            type="button"
                                            role="tab"
                                            aria-selected={goodsDetailShelfTab === GOODS_DETAIL_VIEW_TONKHO}
                                            className={`ah-solo-product-tab${
                                              goodsDetailShelfTab === GOODS_DETAIL_VIEW_TONKHO ? ' is-active' : ''
                                            }`}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setGoodsDetailShelfTab(GOODS_DETAIL_VIEW_TONKHO)
                                            }}
                                          >
                                            Mô tả
                                          </button>
                                          <button
                                            type="button"
                                            role="tab"
                                            aria-selected={goodsDetailShelfTab === GOODS_DETAIL_VIEW_LICHSU}
                                            className={`ah-solo-product-tab${
                                              goodsDetailShelfTab === GOODS_DETAIL_VIEW_LICHSU ? ' is-active' : ''
                                            }`}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setGoodsDetailShelfTab(GOODS_DETAIL_VIEW_LICHSU)
                                            }}
                                          >
                                            Lịch sử kho
                                          </button>
                                          {shouldShowComboBomTab(comboDetailProduct) ? (
                                            <button
                                              type="button"
                                              role="tab"
                                              aria-selected={goodsDetailShelfTab === GOODS_DETAIL_VIEW_COMBO}
                                              className={`ah-solo-product-tab${
                                                goodsDetailShelfTab === GOODS_DETAIL_VIEW_COMBO ? ' is-active' : ''
                                              }`}
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setGoodsDetailShelfTab(GOODS_DETAIL_VIEW_COMBO)
                                              }}
                                            >
                                              Thành phần combo
                                            </button>
                                          ) : null}
                                        </div>
                                        <div
                                          className="ah-solo-product-primary-tools ah-hub-tabstrip-tools--dark"
                                          role="toolbar"
                                          aria-label="Lưu và hủy thay đổi"
                                        >
                                          <button
                                            type="button"
                                            className="ah-solo-product-icon-btn ah-solo-product-icon-btn--discard"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              discardGoodsDetailDraft()
                                            }}
                                            title="Hủy thay đổi (khôi phục từ danh mục)"
                                          >
                                            <svg className="ah-solo-product-tool-svg" viewBox="0 0 24 24" aria-hidden>
                                              <path
                                                fill="currentColor"
                                                d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                                              />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            className="ah-solo-product-icon-btn ah-solo-product-icon-btn--save"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              void saveGoodsDetail()
                                            }}
                                            title="Lưu"
                                          >
                                            <svg
                                              width="22"
                                              height="22"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2.2"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              aria-hidden
                                            >
                                              <path d="M20 6L9 17l-5-5" />
                                            </svg>
                                          </button>
                                        </div>
                                      </div>
                                      <div className="ah-goods-card-name-block">
                                        <div
                                          className="ah-goods-card-name-toolbar"
                                          role="toolbar"
                                          aria-label="Thao tác"
                                        >
                                          <button
                                            type="button"
                                            className="ah-goods-detail-icon-btn"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              copyGoodsDetail()
                                            }}
                                            title="Sao chép"
                                            aria-label="Sao chép"
                                          >
                                            <svg
                                              width="20"
                                              height="20"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="1.75"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              aria-hidden
                                            >
                                              <rect x="9" y="9" width="13" height="13" rx="2" />
                                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            className="ah-goods-detail-icon-btn ah-goods-detail-icon-btn--danger"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              deleteGoodsDetailVariant()
                                            }}
                                            title="Xóa"
                                            aria-label="Xóa"
                                          >
                                            <svg
                                              width="20"
                                              height="20"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="1.75"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              aria-hidden
                                            >
                                              <path d="M3 6h18" />
                                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                              <path d="M10 11v6M14 11v6" />
                                            </svg>
                                          </button>
                                        </div>
                                        <div className="ah-goods-card-title-field ah-goods-card-title-field--full">
                                          <label
                                            className="ah-goods-card-lbl ah-goods-card-lbl--title"
                                            htmlFor={`gd-name-${v.id}`}
                                          >
                                            Tên sản phẩm
                                          </label>
                                          <input
                                            id={`gd-name-${v.id}`}
                                            className="ah-goods-card-input ah-goods-card-title-input ah-goods-card-input--full"
                                            value={d?.name ?? ''}
                                            onChange={(e) =>
                                              setGoodsDetailDraft((x) => {
                                                const base = x ?? buildGoodsDetailDraft(v)
                                                return base ? { ...base, name: e.target.value } : null
                                              })
                                            }
                                            autoComplete="off"
                                            spellCheck={false}
                                            aria-label="Tên sản phẩm"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    {goodsDetailShelfTab === GOODS_DETAIL_VIEW_TONKHO && (
                                      <>
                                      {goodsDetailCtx.variants.length > 1 &&
                                        (() => {
                                          const ordered = sortVariantsSmallestUnitFirst(
                                            goodsDetailCtx.variants
                                          )
                                          const baseV = ordered[0]
                                          const rest = ordered.slice(1)
                                          return (
                                            <div
                                              className="ah-goods-unit-smart-summary"
                                              role="region"
                                              aria-label="Tóm tắt đơn vị"
                                            >
                                              <p className="ah-goods-unit-smart-summary__base">
                                                <strong>Đơn vị cơ bản:</strong>{' '}
                                                {normalizeCatalogUnitLabel(baseV.unitLabel)} · Mã{' '}
                                                <span className="ah-muted-code">
                                                  {String(baseV.code || '').trim() || '—'}
                                                </span>{' '}
                                                · Giá bán{' '}
                                                <strong>
                                                  {Number(baseV.price || 0).toLocaleString('vi-VN')} đ
                                                </strong>
                                              </p>
                                              {rest.length > 0 && (
                                                <>
                                                  <p className="ah-goods-unit-smart-summary__subhead">
                                                    Đơn vị quy đổi
                                                  </p>
                                                  <ul className="ah-goods-unit-smart-summary__list">
                                                    {rest.map((vv) => (
                                                      <li key={vv.id}>
                                                        <button
                                                          type="button"
                                                          className={`ah-goods-unit-smart-summary__btn${
                                                            vv.id === goodsDetailSelectedVid
                                                              ? ' is-active'
                                                              : ''
                                                          }`}
                                                          onClick={() => setGoodsDetailSelectedVid(vv.id)}
                                                        >
                                                          <span className="ah-goods-unit-smart-summary__u">
                                                            {normalizeCatalogUnitLabel(vv.unitLabel)}
                                                          </span>
                                                          <span className="ah-goods-unit-smart-summary__meta">
                                                            {String(vv.code || '').trim() || '—'} —{' '}
                                                            {Number(vv.price || 0).toLocaleString('vi-VN')} đ
                                                            {vv.conversion != null &&
                                                            Number(vv.conversion) > 1
                                                              ? ` · quy đổi ×${vv.conversion}`
                                                              : ''}
                                                          </span>
                                                        </button>
                                                      </li>
                                                    ))}
                                                  </ul>
                                                </>
                                              )}
                                            </div>
                                          )
                                        })()}
                                      <div className="ah-goods-card-unit-row ah-goods-card-unit-row--below-tabs">
                                        <span className="ah-goods-detail-unit-label">
                                          Đang chỉnh
                                        </span>
                                        <select
                                          className="ah-goods-detail-unit-select"
                                          value={goodsDetailSelectedVid ?? ''}
                                          onChange={(e) => {
                                            setGoodsDetailSelectedVid(e.target.value)
                                          }}
                                        >
                                          {goodsDetailCtx.variants.map((vv) => (
                                            <option key={vv.id} value={vv.id}>
                                              {normalizeCatalogUnitLabel(vv.unitLabel)}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      {d ? (
                                        <div className="ah-goods-card-body ah-goods-card-body--below-tabs ah-goods-v2-body-grid">
                                          <div className="ah-goods-card-row">
                                            <div className="ah-goods-card-field">
                                              <label className="ah-goods-card-lbl" htmlFor={`gd-code-${v.id}`}>
                                                Mã hàng
                                              </label>
                                              <input
                                                id={`gd-code-${v.id}`}
                                                className="ah-goods-card-input"
                                                value={d.code}
                                                onChange={(e) =>
                                                  setGoodsDetailDraft((x) =>
                                                    x ? { ...x, code: e.target.value } : x
                                                  )
                                                }
                                                aria-label="Mã hàng"
                                              />
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-barcode-${v.id}`}
                                              >
                                                Mã vạch
                                              </label>
                                              <div className="ah-goods-create-barcode-row ah-goods-card-barcode-row">
                                                <input
                                                  id={`gd-barcode-${v.id}`}
                                                  className="ah-goods-card-input ah-goods-card-input--barcode ah-goods-create-input--barcode"
                                                  value={d.barcode}
                                                  onChange={(e) =>
                                                    setGoodsDetailDraft((x) =>
                                                      x ? { ...x, barcode: e.target.value } : x
                                                    )
                                                  }
                                                  onFocus={(e) => {
                                                    requestAnimationFrame(() => {
                                                      try {
                                                        e.target.select()
                                                      } catch {
                                                        /* ignore */
                                                      }
                                                    })
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                      e.preventDefault()
                                                      e.stopPropagation()
                                                    }
                                                  }}
                                                  autoComplete="off"
                                                  spellCheck={false}
                                                  aria-label="Mã vạch"
                                                />
                                                {typeof onRequestBarcodeScan === 'function' ? (
                                                  <button
                                                    type="button"
                                                    className="barcode-scan-trigger ah-goods-create-barcode-scan"
                                                    aria-label="Quét mã vạch bằng camera"
                                                    title="Quét mã vạch"
                                                    onClick={() => onRequestBarcodeScan()}
                                                  >
                                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                                      <path
                                                        d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                                                        stroke="currentColor"
                                                        strokeWidth="1.75"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                      />
                                                    </svg>
                                                  </button>
                                                ) : null}
                                              </div>
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-stock-${v.id}`}
                                              >
                                                Tồn kho
                                              </label>
                                              <input
                                                id={`gd-stock-${v.id}`}
                                                className="ah-goods-card-input ah-goods-card-input--num"
                                                inputMode="decimal"
                                                value={d.stockQty}
                                                onChange={(e) =>
                                                  setGoodsDetailDraft((x) =>
                                                    x ? { ...x, stockQty: e.target.value } : x
                                                  )
                                                }
                                                aria-label="Tồn kho"
                                              />
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-norm-${v.id}`}
                                              >
                                                Tồn nhỏ nhất
                                              </label>
                                              <input
                                                id={`gd-norm-${v.id}`}
                                                className="ah-goods-card-input ah-goods-card-input--num"
                                                inputMode="decimal"
                                                value={d.ton_nho_nhat}
                                                onChange={(e) =>
                                                  setGoodsDetailDraft((x) =>
                                                    x ? { ...x, ton_nho_nhat: e.target.value } : x
                                                  )
                                                }
                                                aria-label="Tồn nhỏ nhất"
                                              />
                                            </div>
                                          </div>
                                          <div className="ah-goods-card-row ah-goods-card-row--5">
                                            <div className="ah-goods-card-field">
                                              <label className="ah-goods-card-lbl" htmlFor={`gd-cost-${v.id}`}>
                                                Giá vốn
                                              </label>
                                              <input
                                                id={`gd-cost-${v.id}`}
                                                className="ah-goods-card-input ah-goods-card-input--num"
                                                inputMode="numeric"
                                                value={d.cost}
                                                onChange={(e) => {
                                                  const digits = e.target.value.replace(/\D/g, '')
                                                  const n = digits === '' ? 0 : parseInt(digits, 10)
                                                  setGoodsDetailDraft((x) =>
                                                    x
                                                      ? {
                                                          ...x,
                                                          cost:
                                                            digits === ''
                                                              ? ''
                                                              : formatMoneyDraftVi(n),
                                                        }
                                                      : x
                                                  )
                                                }}
                                                aria-label="Giá vốn"
                                              />
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-price-${v.id}`}
                                              >
                                                Giá bán lẻ
                                              </label>
                                              <input
                                                id={`gd-price-${v.id}`}
                                                className="ah-goods-card-input ah-goods-card-input--num"
                                                inputMode="numeric"
                                                value={d.price}
                                                onChange={(e) => {
                                                  const digits = e.target.value.replace(/\D/g, '')
                                                  const n = digits === '' ? 0 : parseInt(digits, 10)
                                                  setGoodsDetailDraft((x) =>
                                                    x
                                                      ? {
                                                          ...x,
                                                          price:
                                                            digits === ''
                                                              ? ''
                                                              : formatMoneyDraftVi(n),
                                                        }
                                                      : x
                                                  )
                                                }}
                                                aria-label="Giá bán lẻ"
                                              />
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-wholesale-${v.id}`}
                                              >
                                                Giá sỉ
                                              </label>
                                              <input
                                                id={`gd-wholesale-${v.id}`}
                                                className="ah-goods-card-input ah-goods-card-input--num"
                                                inputMode="numeric"
                                                value={d.wholesalePrice ?? ''}
                                                onChange={(e) => {
                                                  const digits = e.target.value.replace(/\D/g, '')
                                                  const n = digits === '' ? 0 : parseInt(digits, 10)
                                                  setGoodsDetailDraft((x) =>
                                                    x
                                                      ? {
                                                          ...x,
                                                          wholesalePrice:
                                                            digits === ''
                                                              ? ''
                                                              : formatMoneyDraftVi(n),
                                                        }
                                                      : x
                                                  )
                                                }}
                                                aria-label="Giá sỉ"
                                              />
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-brand-${v.id}`}
                                              >
                                                Thương hiệu
                                              </label>
                                              <div
                                                className="ah-goods-detail-brand-wrap"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <InboundThuongHieuAutocomplete
                                                  id={`gd-brand-${v.id}`}
                                                  value={d.brand ?? ''}
                                                  onValueChange={(s) =>
                                                    setGoodsDetailDraft((x) =>
                                                      x ? { ...x, brand: s } : x
                                                    )
                                                  }
                                                  options={goodsBrandAutocompleteOptions}
                                                  placeholder="Chọn hoặc gõ…"
                                                  filterDebounceMs={280}
                                                  listMaxHeight={228}
                                                  showAddSupplierEntry={Boolean(onRequestAddSupplier)}
                                                  onRequestAddSupplier={async () => {
                                                    const createdName = await Promise.resolve(
                                                      onRequestAddSupplier?.()
                                                    )
                                                    const normalizedName = String(createdName || '').trim()
                                                    if (!normalizedName) return
                                                    setGoodsDetailDraft((x) =>
                                                      x ? { ...x, brand: normalizedName } : x
                                                    )
                                                  }}
                                                />
                                              </div>
                                            </div>
                                            <div className="ah-goods-card-field">
                                              <label
                                                className="ah-goods-card-lbl"
                                                htmlFor={`gd-weight-${v.id}`}
                                              >
                                                Trọng lượng
                                              </label>
                                              <input
                                                id={`gd-weight-${v.id}`}
                                                className="ah-goods-card-input"
                                                value={d.weightRaw}
                                                onChange={(e) =>
                                                  setGoodsDetailDraft((x) =>
                                                    x ? { ...x, weightRaw: e.target.value } : x
                                                  )
                                                }
                                                aria-label="Trọng lượng"
                                              />
                                            </div>
                                          </div>
                                          <div className="ah-goods-unit-modal-open-wrap">
                                            <button
                                              type="button"
                                              className="ah-goods-unit-modal-open-link"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                openGoodsUnitModal()
                                              }}
                                            >
                                              + Thêm đơn vị tính
                                            </button>
                                          </div>
                                          {goodsInventoryPreviewRows?.length && !onCloseGoodsDetail ? (
                                            <div
                                              className="ah-goods-inventory-movement-preview"
                                              onClick={(e) => e.stopPropagation()}
                                              role="region"
                                              aria-label="Lịch sử biến động kho — xem trước"
                                            >
                                              <h4 className="ah-goods-inventory-movement-preview__title">
                                                Lịch sử biến động
                                              </h4>
                                              <p className="admin-hub-muted ah-goods-inventory-movement-preview__hint">
                                                Tóm tắt gần nhất — đầy đủ trong tab «Lịch sử kho». Bấm mã chứng từ (HD… /
                                                PN…) để xem chứng từ trong Hub.
                                              </p>
                                              <div className="admin-hub-table-wrap">
                                                <table className="admin-hub-table ah-solo-stock-table">
                                                  <thead>
                                                    <tr>
                                                      <th>Ngày</th>
                                                      <th>Nhân viên</th>
                                                      <th>Thao tác</th>
                                                      <th>ĐVT giao dịch</th>
                                                      <th>Quy đổi</th>
                                                      <th className="ah-num">SL cơ bản</th>
                                                      <th className="ah-num">Tồn kho</th>
                                                      <th>Mã chứng từ</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {goodsInventoryPreviewRows.map((pr) => (
                                                      <tr key={`pv-${pr.key}`}>
                                                        <td className="ah-solo-stock-cell-time">{pr.dateLabel}</td>
                                                        <td>{pr.staffNameLabel ?? pr.staff}</td>
                                                        <td>{pr.transactionTypeLabel ?? pr.action}</td>
                                                        <td className="ah-inv-ledger-unit-txn" title={pr.unitConversionDetailLabel}>
                                                          {pr.unitTxnLabel ?? '—'}
                                                        </td>
                                                        <td className="ah-inv-ledger-conversion" title={pr.unitConversionDetailLabel}>
                                                          {pr.conversionLabel ?? '—'}
                                                        </td>
                                                        <td className={`ah-num${pr.delta > 0 ? ' ah-solo-stock-delta--pos' : pr.delta < 0 ? ' ah-solo-stock-delta--neg' : ''}`}>
                                                          {pr.qtyLabel ?? pr.deltaLabel}
                                                        </td>
                                                        <td className="ah-num">{pr.stockAfterLabel ?? pr.balanceLabel}</td>
                                                        <td onClick={(e) => e.stopPropagation()}>
                                                          {(pr.docLink || (pr.inventoryNavSource === 'supabase' && pr.inventoryDocClickable)) ? (
                                                            <button
                                                              type="button"
                                                              className="ah-solo-stock-doc-link"
                                                              onClick={() => onInventoryDocumentActivate?.(pr)}
                                                            >
                                                              {pr.docNo}
                                                            </button>
                                                          ) : (
                                                            pr.docNo
                                                          )}
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <div className="ah-goods-card-body ah-goods-card-body--loading ah-goods-card-body--below-tabs">
                                          <span className="admin-hub-muted">Đang tải…</span>
                                        </div>
                                      )}
                                      </>
                                    )}
                                    {goodsDetailShelfTab === GOODS_DETAIL_VIEW_LICHSU && (
                                      <div className="ah-goods-card-stock-wrap">
                                        <div
                                          className="ah-inv-ledger-filter-bar"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <div className="ah-inv-ledger-filter-field">
                                            <label className="ah-inv-ledger-filter-lbl" htmlFor="ah-goods-inv-from">
                                              Từ ngày
                                            </label>
                                            <input
                                              id="ah-goods-inv-from"
                                              type="date"
                                              className="ah-goods-card-input ah-inv-ledger-filter-input"
                                              value={goodsInvLedgerDateFrom}
                                              onChange={(e) => onGoodsInvLedgerDateFromChange?.(e.target.value)}
                                            />
                                          </div>
                                          <div className="ah-inv-ledger-filter-field">
                                            <label className="ah-inv-ledger-filter-lbl" htmlFor="ah-goods-inv-to">
                                              Đến ngày
                                            </label>
                                            <input
                                              id="ah-goods-inv-to"
                                              type="date"
                                              className="ah-goods-card-input ah-inv-ledger-filter-input"
                                              value={goodsInvLedgerDateTo}
                                              onChange={(e) => onGoodsInvLedgerDateToChange?.(e.target.value)}
                                            />
                                          </div>
                                          <div className="ah-inv-ledger-filter-field ah-inv-ledger-filter-field--grow">
                                            <label
                                              className="ah-inv-ledger-filter-lbl"
                                              htmlFor="ah-goods-inv-doc"
                                            >
                                              Mã chứng từ
                                            </label>
                                            <input
                                              id="ah-goods-inv-doc"
                                              type="search"
                                              className="ah-goods-card-input ah-inv-ledger-filter-input"
                                              placeholder="Tìm HD…, PN…"
                                              value={goodsInvLedgerDocumentSearch}
                                              autoComplete="off"
                                              spellCheck={false}
                                              onChange={(e) =>
                                                onGoodsInvLedgerDocumentSearchChange?.(e.target.value)
                                              }
                                            />
                                          </div>
                                        </div>
                                        <div className="admin-hub-table-wrap ah-solo-stock-table-wrap">
                                          <table className="admin-hub-table ah-solo-stock-table">
                                            <thead>
                                              <tr>
                                                <th>Ngày</th>
                                                <th>Nhân viên</th>
                                                <th>Thao tác</th>
                                                <th>ĐVT giao dịch</th>
                                                <th>Quy đổi</th>
                                                <th className="ah-num">SL cơ bản</th>
                                                <th className="ah-num">Tồn kho</th>
                                                <th>Mã chứng từ</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {glLoading ? (
                                                <tr>
                                                  <td colSpan={8} className="admin-hub-muted">
                                                    Đang tải nhật ký từ Supabase…
                                                  </td>
                                                </tr>
                                              ) : glRows.length === 0 ? (
                                                <tr>
                                                  <td colSpan={8} className="admin-hub-muted">
                                                    {glLegacyEmptyMsg}
                                                  </td>
                                                </tr>
                                              ) : (
                                                glRows.map((row) => (
                                                    <tr key={row.key}>
                                                      <td className="ah-solo-stock-cell-time">{row.dateLabel}</td>
                                                      <td>{row.staffNameLabel ?? row.staff}</td>
                                                      <td>{row.transactionTypeLabel ?? row.action}</td>
                                                      <td
                                                        className="ah-inv-ledger-unit-txn"
                                                        title={row.unitConversionDetailLabel}
                                                      >
                                                        {row.unitTxnLabel ?? '—'}
                                                      </td>
                                                      <td
                                                        className="ah-inv-ledger-conversion"
                                                        title={row.unitConversionDetailLabel}
                                                      >
                                                        {row.conversionLabel ?? '—'}
                                                      </td>
                                                      <td
                                                        className={`ah-num${
                                                          row.delta > 0
                                                            ? ' ah-solo-stock-delta--pos'
                                                            : row.delta < 0
                                                              ? ' ah-solo-stock-delta--neg'
                                                              : ''
                                                        }`}
                                                      >
                                                        {row.qtyLabel ?? row.deltaLabel}
                                                      </td>
                                                      <td className="ah-num">{row.stockAfterLabel ?? row.balanceLabel}</td>
                                                      <td onClick={(e) => e.stopPropagation()}>
                                                        {(row.docLink || (row.inventoryNavSource === 'supabase' && row.inventoryDocClickable)) ? (
                                                          <button
                                                            type="button"
                                                            className="ah-solo-stock-doc-link"
                                                            onClick={() => onInventoryDocumentActivate?.(row)}
                                                          >
                                                            {row.docNo}
                                                          </button>
                                                        ) : (
                                                          row.docNo
                                                        )}
                                                      </td>
                                                    </tr>
                                                  ))
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}
                                    {goodsDetailShelfTab === GOODS_DETAIL_VIEW_COMBO &&
                                    shouldShowComboBomTab(comboDetailProduct) ? (
                                      <div className="ah-goods-card-stock-wrap">
                                        <AdminHubComboBomPanel
                                          catalogList={catalogList}
                                          comboProduct={comboDetailProduct}
                                          onEditComboProduct={onEditComboProduct}
                                        />
                                      </div>
                                    ) : null}
                                    {onCloseGoodsDetail ? (
                                      <footer className="ah-goods-v2-sticky-foot" role="toolbar" aria-label="Lưu và thoát">
                                        <button
                                          type="button"
                                          className="ah-goods-v2-foot-btn ah-goods-v2-foot-btn--ghost"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onCloseGoodsDetail()
                                          }}
                                        >
                                          Thoát
                                        </button>
                                        <button
                                          type="button"
                                          className="ah-goods-v2-foot-btn ah-goods-v2-foot-btn--save"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void saveGoodsDetail()
                                          }}
                                        >
                                          Lưu
                                        </button>
                                      </footer>
                                    ) : null}
                                    {!onCloseGoodsDetail ? (
                                    <p className="ah-goods-detail-hint ah-goods-detail-hint--card">
                                      Nhấn Esc để đóng chi tiết.
                                    </p>
                                    ) : null}
                                  </div>
                                </div>
    </div>
  )
}

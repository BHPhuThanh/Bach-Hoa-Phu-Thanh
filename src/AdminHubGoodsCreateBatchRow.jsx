import { Fragment } from 'react'
import { formatMoneyThousandsTyping } from './moneyInputFormat.js'
import { batchBarcodeFieldKey } from './goodsCreateBatch.js'

function BrandField({ row, index, layout, brandOptions, onPatch }) {
  const listId = `batch-brand-${row.rowId}`
  const input = (
    <>
      <input
        className="ah-goods-create-input"
        type="text"
        list={brandOptions.length > 0 ? listId : undefined}
        value={row.brand}
        placeholder="Thương hiệu"
        autoComplete="off"
        onChange={(e) => onPatch(index, 'brand', e.target.value)}
      />
      {brandOptions.length > 0 ? (
        <datalist id={listId}>
          {brandOptions.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      ) : null}
    </>
  )

  if (layout === 'card') {
    return (
      <label className="ah-goods-create-batch-card-field">
        <span className="ah-goods-create-label">Thương hiệu</span>
        {input}
      </label>
    )
  }

  return input
}

function BarcodeInput({
  value,
  fieldKey,
  barcodeErrors,
  onPatch,
  onBlur,
  placeholder,
  className = 'ah-goods-create-input ah-goods-create-input--barcode',
}) {
  const errMsg = barcodeErrors[fieldKey]
  const inputClass = `${className}${errMsg ? ' ah-goods-create-input--err' : ''}`
  return (
    <div className="ah-goods-create-batch-barcode-wrap">
      <input
        className={inputClass}
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={errMsg ? true : undefined}
        onChange={(e) => onPatch(e.target.value)}
        onBlur={onBlur}
      />
      {errMsg ? (
        <span className="ah-goods-create-batch-field-err" role="alert">
          {errMsg}
        </span>
      ) : null}
    </div>
  )
}

function ExtraUnitsPanel({
  row,
  index,
  layout,
  barcodeErrors,
  onPatchExtra,
  onAddExtra,
  onRemoveExtra,
  onBarcodeBlur,
}) {
  const units = row.donViTinh || []
  if (!row.extraUnitsOpen && units.length === 0) {
    return (
      <button type="button" className="ah-goods-create-batch-add-unit" onClick={() => onAddExtra(index)}>
        + Thêm đơn vị tính
      </button>
    )
  }

  return (
    <div className="ah-goods-create-batch-units">
      {units.map((unit, ui) => (
        <div key={unit.unitId} className="ah-goods-create-batch-unit-block">
          <div className="ah-goods-create-batch-unit-head">
            <span className="ah-goods-create-batch-unit-title">Đơn vị {ui + 2}</span>
            <button
              type="button"
              className="ah-goods-create-batch-unit-remove"
              aria-label="Xóa đơn vị"
              onClick={() => onRemoveExtra(index, ui)}
            >
              ×
            </button>
          </div>
          <div
            className={
              layout === 'card'
                ? 'ah-goods-create-batch-unit-grid ah-goods-create-batch-unit-grid--card'
                : 'ah-goods-create-batch-unit-grid'
            }
          >
            <label className="ah-goods-create-batch-unit-field">
              <span className="ah-goods-create-label">Đơn vị</span>
              <input
                className="ah-goods-create-input"
                type="text"
                value={unit.unitLabel}
                placeholder="Thùng, lốc…"
                onChange={(e) => onPatchExtra(index, ui, 'unitLabel', e.target.value)}
              />
            </label>
            <label className="ah-goods-create-batch-unit-field">
              <span className="ah-goods-create-label">Quy đổi</span>
              <input
                className="ah-goods-create-input ah-goods-create-input--num"
                type="text"
                inputMode="decimal"
                value={unit.conversion}
                placeholder="6"
                title="1 đơn vị này = ? đơn vị cơ bản"
                onChange={(e) => onPatchExtra(index, ui, 'conversion', e.target.value)}
              />
            </label>
            <label className="ah-goods-create-batch-unit-field">
              <span className="ah-goods-create-label">Giá bán</span>
              <input
                className="ah-goods-create-input ah-goods-create-input--num"
                type="text"
                inputMode="numeric"
                value={unit.price}
                onChange={(e) =>
                  onPatchExtra(index, ui, 'price', formatMoneyThousandsTyping(e.target.value))
                }
              />
            </label>
            <label className="ah-goods-create-batch-unit-field">
              <span className="ah-goods-create-label">Giá vốn</span>
              <input
                className="ah-goods-create-input ah-goods-create-input--num"
                type="text"
                inputMode="numeric"
                value={unit.cost}
                onChange={(e) =>
                  onPatchExtra(index, ui, 'cost', formatMoneyThousandsTyping(e.target.value))
                }
              />
            </label>
            <label className="ah-goods-create-batch-unit-field ah-goods-create-batch-unit-field--barcode">
              <span className="ah-goods-create-label">Mã vạch</span>
              <BarcodeInput
                value={unit.barcode}
                fieldKey={batchBarcodeFieldKey(row.rowId, unit.unitId)}
                barcodeErrors={barcodeErrors}
                onPatch={(v) => onPatchExtra(index, ui, 'barcode', v)}
                onBlur={() => onBarcodeBlur(index, unit.unitId)}
                placeholder="QR (tuỳ chọn)"
              />
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="ah-goods-create-batch-add-unit" onClick={() => onAddExtra(index)}>
        + Thêm đơn vị tính
      </button>
    </div>
  )
}

/**
 * @param {'table' | 'card'} layout
 */
export default function AdminHubGoodsCreateBatchRow({
  row,
  index,
  layout,
  brandOptions = [],
  barcodeErrors = {},
  onPatch,
  onPatchExtra,
  onAddExtra,
  onRemoveExtra,
  onRemove,
  onBarcodeBlur,
  canRemove,
  rowLabel,
}) {
  const mainBarcodeKey = batchBarcodeFieldKey(row.rowId)

  if (layout === 'card') {
    return (
      <article className="ah-goods-create-batch-card" aria-label={rowLabel}>
        <header className="ah-goods-create-batch-card-head">
          <span className="ah-goods-create-batch-card-num">{rowLabel}</span>
          <button
            type="button"
            className="ah-goods-create-batch-del-btn"
            aria-label="Xóa sản phẩm"
            disabled={!canRemove}
            onClick={() => onRemove(index)}
          >
            ×
          </button>
        </header>
        <div className="ah-goods-create-batch-card-body">
          <label className="ah-goods-create-batch-card-field">
            <span className="ah-goods-create-label">
              Tên hàng <span className="ah-goods-create-req">*</span>
            </span>
            <input
              className="ah-goods-create-input"
              type="text"
              value={row.name}
              placeholder="Tên hàng"
              autoComplete="off"
              onChange={(e) => onPatch(index, 'name', e.target.value)}
            />
          </label>
          <BrandField
            row={row}
            index={index}
            layout={layout}
            brandOptions={brandOptions}
            onPatch={onPatch}
          />
          <label className="ah-goods-create-batch-card-field">
            <span className="ah-goods-create-label">Mã vạch / QR</span>
            <BarcodeInput
              value={row.barcode}
              fieldKey={mainBarcodeKey}
              barcodeErrors={barcodeErrors}
              onPatch={(v) => onPatch(index, 'barcode', v)}
              onBlur={() => onBarcodeBlur(index, null)}
            />
          </label>
          <div className="ah-goods-create-batch-card-row2">
            <label className="ah-goods-create-batch-card-field ah-goods-create-batch-card-field--half">
              <span className="ah-goods-create-label">Mã hàng</span>
              <input
                className="ah-goods-create-input"
                type="text"
                value={row.code}
                placeholder="Tự HH"
                autoComplete="off"
                onChange={(e) => onPatch(index, 'code', e.target.value)}
              />
            </label>
            <label className="ah-goods-create-batch-card-field ah-goods-create-batch-card-field--half">
              <span className="ah-goods-create-label">ĐVT cơ bản</span>
              <input
                className="ah-goods-create-input"
                type="text"
                value={row.unitLabel}
                placeholder="Cái"
                autoComplete="off"
                onChange={(e) => onPatch(index, 'unitLabel', e.target.value)}
              />
            </label>
          </div>
          <div className="ah-goods-create-batch-card-row3">
            <label className="ah-goods-create-batch-card-field">
              <span className="ah-goods-create-label">Giá bán</span>
              <input
                className="ah-goods-create-input ah-goods-create-input--num"
                type="text"
                inputMode="numeric"
                value={row.price}
                onChange={(e) => onPatch(index, 'price', formatMoneyThousandsTyping(e.target.value))}
              />
            </label>
            <label className="ah-goods-create-batch-card-field">
              <span className="ah-goods-create-label">Giá vốn</span>
              <input
                className="ah-goods-create-input ah-goods-create-input--num"
                type="text"
                inputMode="numeric"
                value={row.cost}
                onChange={(e) => onPatch(index, 'cost', formatMoneyThousandsTyping(e.target.value))}
              />
            </label>
            <label className="ah-goods-create-batch-card-field">
              <span className="ah-goods-create-label">Tồn</span>
              <input
                className="ah-goods-create-input ah-goods-create-input--num"
                type="text"
                inputMode="numeric"
                value={row.stock}
                onChange={(e) => onPatch(index, 'stock', e.target.value)}
              />
            </label>
          </div>
          <ExtraUnitsPanel
            row={row}
            index={index}
            layout={layout}
            barcodeErrors={barcodeErrors}
            onPatchExtra={onPatchExtra}
            onAddExtra={onAddExtra}
            onRemoveExtra={onRemoveExtra}
            onBarcodeBlur={onBarcodeBlur}
          />
        </div>
      </article>
    )
  }

  const colSpan = 9

  return (
    <Fragment key={row.rowId}>
      <tr>
        <td className="ah-goods-create-batch-td-name">
          <input
            className="ah-goods-create-input"
            type="text"
            value={row.name}
            placeholder="Tên hàng"
            autoComplete="off"
            onChange={(e) => onPatch(index, 'name', e.target.value)}
          />
        </td>
      <td className="ah-goods-create-batch-td-brand">
        <BrandField
          row={row}
          index={index}
          layout={layout}
          brandOptions={brandOptions}
          onPatch={onPatch}
        />
      </td>
        <td className="ah-goods-create-batch-td-code">
          <input
            className="ah-goods-create-input"
            type="text"
            value={row.code}
            placeholder="Tự HH"
            autoComplete="off"
            onChange={(e) => onPatch(index, 'code', e.target.value)}
          />
        </td>
        <td className="ah-goods-create-batch-td-barcode">
          <BarcodeInput
            value={row.barcode}
            fieldKey={mainBarcodeKey}
            barcodeErrors={barcodeErrors}
            onPatch={(v) => onPatch(index, 'barcode', v)}
            onBlur={() => onBarcodeBlur(index, null)}
            placeholder="QR"
          />
        </td>
        <td>
          <input
            className="ah-goods-create-input"
            type="text"
            value={row.unitLabel}
            placeholder="Cái"
            autoComplete="off"
            onChange={(e) => onPatch(index, 'unitLabel', e.target.value)}
          />
        </td>
        <td>
          <input
            className="ah-goods-create-input ah-goods-create-input--num"
            type="text"
            inputMode="numeric"
            value={row.price}
            onChange={(e) => onPatch(index, 'price', formatMoneyThousandsTyping(e.target.value))}
          />
        </td>
        <td>
          <input
            className="ah-goods-create-input ah-goods-create-input--num"
            type="text"
            inputMode="numeric"
            value={row.cost}
            onChange={(e) => onPatch(index, 'cost', formatMoneyThousandsTyping(e.target.value))}
          />
        </td>
        <td>
          <input
            className="ah-goods-create-input ah-goods-create-input--num"
            type="text"
            inputMode="numeric"
            value={row.stock}
            onChange={(e) => onPatch(index, 'stock', e.target.value)}
          />
        </td>
        <td className="ah-goods-create-batch-del">
          <button
            type="button"
            className="ah-goods-create-batch-del-btn"
            aria-label="Xóa dòng"
            disabled={!canRemove}
            onClick={() => onRemove(index)}
          >
            ×
          </button>
        </td>
      </tr>
      <tr className="ah-goods-create-batch-units-tr">
        <td colSpan={colSpan}>
          <ExtraUnitsPanel
            row={row}
            index={index}
            layout={layout}
            barcodeErrors={barcodeErrors}
            onPatchExtra={onPatchExtra}
            onAddExtra={onAddExtra}
            onRemoveExtra={onRemoveExtra}
            onBarcodeBlur={onBarcodeBlur}
          />
        </td>
      </tr>
    </Fragment>
  )
}

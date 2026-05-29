import { formatMoneyThousandsTyping } from './moneyInputFormat.js'

/**
 * Ô nhập một dòng batch — dùng chung cho bảng desktop và thẻ mobile.
 * @param {'table' | 'card'} layout
 */
export default function AdminHubGoodsCreateBatchRow({
  row,
  index,
  layout,
  barcodeError,
  onPatch,
  onRemove,
  canRemove,
  rowLabel,
}) {
  const barcodeInputClass = `ah-goods-create-input ah-goods-create-input--barcode${
    barcodeError ? ' ah-goods-create-input--err' : ''
  }`

  const fields = (
    <>
      {layout === 'card' ? (
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
      ) : null}

      {layout === 'card' ? (
        <label className="ah-goods-create-batch-card-field">
          <span className="ah-goods-create-label">Mã vạch / QR</span>
          <input
            className={barcodeInputClass}
            type="text"
            value={row.barcode}
            placeholder="Quét hoặc nhập"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={barcodeError || undefined}
            onChange={(e) => onPatch(index, 'barcode', e.target.value)}
          />
          {barcodeError ? (
            <span className="ah-goods-create-batch-field-err" role="alert">
              Mã vạch trùng
            </span>
          ) : null}
        </label>
      ) : null}

      <div className={layout === 'card' ? 'ah-goods-create-batch-card-row2' : undefined}>
        {layout === 'card' ? (
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
        ) : null}
        {layout === 'card' ? (
          <label className="ah-goods-create-batch-card-field ah-goods-create-batch-card-field--half">
            <span className="ah-goods-create-label">ĐVT</span>
            <input
              className="ah-goods-create-input"
              type="text"
              value={row.unitLabel}
              placeholder="Cái"
              autoComplete="off"
              onChange={(e) => onPatch(index, 'unitLabel', e.target.value)}
            />
          </label>
        ) : null}
      </div>

      {layout === 'card' ? (
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
      ) : null}
    </>
  )

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
        <div className="ah-goods-create-batch-card-body">{fields}</div>
      </article>
    )
  }

  return (
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
        <input
          className={barcodeInputClass}
          type="text"
          value={row.barcode}
          placeholder="QR"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={barcodeError || undefined}
          onChange={(e) => onPatch(index, 'barcode', e.target.value)}
        />
        {barcodeError ? (
          <span className="ah-goods-create-batch-field-err" role="alert">
            Trùng
          </span>
        ) : null}
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
  )
}

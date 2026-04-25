import { Component } from 'react'

/**
 * Cô lập lỗi render theo tab: lỗi ở Nhập hàng / Hàng hóa không làm mất toàn bộ hub (Doanh thu vẫn mở lại được sau khi đổi tab).
 */
export default class AdminHubTabErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[AdminHubTab]', this.props.tabLabel || 'tab', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    const { tabLabel, children } = this.props
    if (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const name = error instanceof Error ? error.name : 'Error'
      return (
        <div className="ah-tab-error-boundary" role="alert">
          <h2 className="ah-tab-error-boundary__title">Lỗi hiển thị tab: {tabLabel || '—'}</h2>
          <p className="ah-tab-error-boundary__code">
            {name}: {msg}
          </p>
          <p className="ah-tab-error-boundary__hint">
            Đổi sang tab khác (ví dụ <strong>Doanh thu</strong>) rồi quay lại, hoặc tải lại trang. Chi tiết trong
            Console: <code>[AdminHubTab]</code>.
          </p>
          <button
            type="button"
            className="ah-tab-error-boundary__retry"
            onClick={() => this.setState({ error: null })}
          >
            Thử lại tab này
          </button>
        </div>
      )
    }
    return children
  }
}

import { Component } from 'react'

export default class DoanhThuErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[DoanhThu]', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const name = error instanceof Error ? error.name : 'Error'
      return (
        <main className="ah-route-error" role="alert">
          <h1 className="ah-route-error__title">Không tải được trang Doanh thu</h1>
          <p className="ah-route-error__code">
            {name}: {msg}
          </p>
          <p className="ah-route-error__hint">
            Mở DevTools (F12) → tab Console và gửi lại nội dung lỗi đỏ phía trên dòng{' '}
            <code>[DoanhThu]</code>.
          </p>
          <button
            type="button"
            className="ah-route-error__reload"
            onClick={() => window.location.reload()}
          >
            Tải lại trang
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <section className="screen">
        <div className="empty-state">
          <strong>Unable to load this screen</strong>
          <span>Something went wrong. Retry without leaving the app.</span>
          <button className="primary-button" type="button" onClick={() => this.setState({ failed: false })}>Retry</button>
        </div>
      </section>
    )
  }
}

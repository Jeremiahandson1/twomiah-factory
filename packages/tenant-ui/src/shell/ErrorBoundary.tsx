// Error boundary with a reset key: the shell wraps each routed page in one keyed by the pathname, so a
// crashed page keeps the sidebar/header usable and clears itself on navigation instead of one crash
// breaking every subsequent page until a full reload.
import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

interface Props { children?: React.ReactNode; resetKey?: unknown; fallback?: (error: any, reset: () => void) => React.ReactNode; message?: string; onReset?: () => void }
interface State { hasError: boolean; error: any; errorInfo: any; lastKey: unknown }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null, lastKey: props.resetKey }
  }
  static getDerivedStateFromError(error: any) { return { hasError: true, error } }
  static getDerivedStateFromProps(props: Props, state: State) {
    if (props.resetKey !== state.lastKey) return { hasError: false, error: null, errorInfo: null, lastKey: props.resetKey }
    return null
  }
  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ errorInfo })
    console.error('Error caught by boundary:', error, errorInfo)
  }
  handleReset = () => { this.setState({ hasError: false, error: null, errorInfo: null }); this.props.onReset?.() }
  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.error, this.handleReset)
    return (
      <div className="min-h-[400px] flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><AlertTriangle className="w-8 h-8 text-red-500" /></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2 dark:text-slate-100">Something went wrong</h2>
          <p className="text-gray-600 mb-6 dark:text-slate-400">{this.props.message || "We're sorry, but something unexpected happened. Please try again."}</p>
          {this.state.error && (
            <details className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-left">
              <summary className="text-sm text-red-700 dark:text-red-200 cursor-pointer">Details</summary>
              <p className="mt-2 font-mono text-xs text-red-800 dark:text-red-100 break-all">{String(this.state.error)}</p>
            </details>
          )}
          <div className="flex gap-3 justify-center">
            <button type="button" onClick={this.handleReset} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"><RefreshCw className="w-4 h-4" />Try Again</button>
            <button type="button" onClick={() => { window.location.href = '/' }} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200"><Home className="w-4 h-4" />Go Home</button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary

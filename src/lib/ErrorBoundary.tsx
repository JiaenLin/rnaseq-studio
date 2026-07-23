import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Catches render-phase errors in a subtree so one failing view degrades to a
// visible, recoverable message instead of blanking the whole app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: unknown) {
    // Surface the details for debugging.
    console.error('[RNA-seq Studio] view crashed:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="card m-2 p-5">
        <h2 className="text-base font-semibold text-red-600">This view hit an error.</h2>
        <p className="mt-1 text-sm text-slate-500">The rest of the app is fine — switch tabs, or reset this view.</p>
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
{error.message}{error.stack ? '\n\n' + error.stack : ''}
        </pre>
        <button className="btn mt-3" onClick={() => this.setState({ error: null })}>Reset view</button>
      </div>
    )
  }
}

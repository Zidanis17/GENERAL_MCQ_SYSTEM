import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    if (this.state.error) return <main className="fatal"><h1>Let’s get you back to studying.</h1><p>The interface encountered a problem. Your saved progress is kept on this computer.</p><button className="button primary" onClick={() => location.reload()}>Reload MCQ Studio</button></main>
    return this.props.children
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)

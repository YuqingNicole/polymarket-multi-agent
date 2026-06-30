'use client'
import { useEffect, useState } from 'react'
import { Dc } from './Dc'
import { useTerminal } from './useTerminal'
import { TERMINAL_MARKUP } from './markup'

// The terminal: ports the prototype logic (useTerminal) and renders the
// original markup through the dc interpreter. Client-only (uses DOMParser and
// a live clock), so it mounts after hydration.
export default function Terminal() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const scope = useTerminal()
  if (!mounted) return null
  return (
    <div className="augur-shell">
      <Dc markup={TERMINAL_MARKUP} scope={scope} />
      <footer className="augur-footer">
        <div className="grp">
          {scope.dataMode === 'live' ? (
            <span
              className="augur-mode"
              style={{ color: 'var(--up)', background: 'var(--tint-green)', borderColor: 'var(--up)' }}
            >
              ● LIVE 真实行情
            </span>
          ) : (
            <span
              className="augur-mode"
              style={{ color: 'var(--amber)', background: 'var(--tint-amber)', borderColor: 'var(--amber)' }}
            >
              ● DEMO 演示数据
            </span>
          )}
          <span className="it"><span className="d" style={{ background: 'var(--up)' }} />Polymarket</span>
          <span className="it"><span className="d" style={{ background: 'var(--up)' }} />Kalshi</span>
          <span className="it"><span className="d" style={{ background: 'var(--accent)' }} />Agent · DeepSeek</span>
          <span className="muted">{String(scope.signalCount ?? '')} 信号 · {String(scope.marketCount ?? '')} 标的</span>
        </div>
        <div className="grp">
          <span><b>Augur Terminal</b> v0.3</span>
          <span className="sep">·</span>
          <span className="muted">Polymarket × Kalshi · 仅供分析演示,非投资建议</span>
        </div>
      </footer>
    </div>
  )
}

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
  return <Dc markup={TERMINAL_MARKUP} scope={scope} />
}

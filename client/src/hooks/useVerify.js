// hooks/useVerify.js
// Shared streaming email verification logic used by both LandingPage and AppPage
import { useState, useCallback, useRef } from 'react'

export function useVerify() {
  const [results, setResults]       = useState([])
  const [total, setTotal]           = useState(0)
  const [done, setDone]             = useState(0)
  const [status, setStatus]         = useState('idle') // idle | running | complete | error
  const [errorMsg, setErrorMsg]     = useState('')
  const abortRef                    = useRef(null)

  const verify = useCallback(async ({ emails = [], file = null }) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setResults([])
    setTotal(0)
    setDone(0)
    setErrorMsg('')
    setStatus('running')

    try {
      let res
      if (file) {
        const fd = new FormData()
        fd.append('csvfile', file)
        res = await fetch('/verify', { method: 'POST', body: fd, signal: ctrl.signal })
      } else {
        res = await fetch('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails }),
          signal: ctrl.signal,
        })
      }

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(j.error || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          const t = line.trim()
          if (!t) continue
          let msg
          try { msg = JSON.parse(t) } catch { continue }
          if (msg.type === 'total') {
            setTotal(msg.count)
          } else if (msg.type === 'result') {
            setResults(prev => [...prev, msg.data])
            setDone(prev => prev + 1)
          }
        }
      }
      setStatus('complete')
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorMsg(err.message)
      setStatus('error')
    }
  }, [])

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setResults([])
    setTotal(0)
    setDone(0)
    setStatus('idle')
    setErrorMsg('')
  }, [])

  return { results, total, done, status, errorMsg, verify, reset }
}

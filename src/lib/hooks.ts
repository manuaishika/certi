import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, errMessage } from './backend'

/** Loads `fn` once and whenever deps change. `reload()` refetches without clearing existing data. */
export function useRpc<T = any>(fn: string | null, args: Record<string, any> = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(!!fn)
  const seq = useRef(0)
  const argsRef = useRef(args); argsRef.current = args
  const reload = useCallback(async () => {
    if (!fn) return
    const my = ++seq.current
    try { const r = await api.rpc<T>(fn, argsRef.current); if (my === seq.current) { setData(r); setError('') } }
    catch (e) { if (my === seq.current) setError(errMessage(e)) }
    finally { if (my === seq.current) setLoading(false) }
  }, [fn])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(!!fn); reload() }, [fn, reload, ...deps])
  return { data, error, loading, reload, setData }
}

/** Wraps an async action: toasts errors, tracks busy state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true)
    try { const r = await fn(); if (ok) toast.success(ok); return r }
    catch (e) { toast.error(errMessage(e)); return undefined }
    finally { setBusy(false) }
  }, [])
  return { busy, run }
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

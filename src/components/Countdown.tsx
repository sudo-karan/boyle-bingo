import { useEffect, useState } from 'react'

// Compact live countdown to an ISO timestamp.
export default function Countdown({ to }: { to: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = new Date(to).getTime() - Date.now()
  if (ms <= 0) return <span>now</span>
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60), sec = s % 60
  const parts = d ? [`${d}d`, `${h}h`] : h ? [`${h}h`, `${m}m`] : [`${m}m`, `${sec}s`]
  return <span>{parts.join(' ')}</span>
}

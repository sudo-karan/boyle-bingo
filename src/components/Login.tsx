import { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { await signIn(username, password) }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="app">
      <div className="big-target"><h1>Boyle Bingo</h1></div>
      <form className="panel col" onSubmit={submit}>
        <label className="field">
          <span>Username</span>
          <input autoCapitalize="none" autoCorrect="off" value={username}
                 onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password}
                 onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="banner err">{err}</div>}
        <button className="primary" disabled={busy || !username || !password}>
          {busy ? '…' : 'Sign in'}
        </button>
      </form>
      <p className="muted small center">Ask your admin for an account.</p>
    </div>
  )
}

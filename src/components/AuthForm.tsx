'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.message ?? '出了点问题，再试一次')
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('连不上服务器，检查网络后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <h1>旅痕</h1>
          <p>CHINA FOOTPRINT MAP</p>
        </div>

        <div className="auth-box">
          <form onSubmit={submit}>
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />

            <label htmlFor="pwd">密码</label>
            <input
              id="pwd"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="current-password"
            />

            {error && <p className="auth-err">{error}</p>}

            <button type="submit" className="btn btn-p" disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
          </form>
        </div>

        <p className="auth-hint">
          这是个人自用的账号，不开放注册。
          <br />
          需要改密码或加账号，跑一次 <code>npm run db:seed</code>。
        </p>
      </div>
    </div>
  )
}

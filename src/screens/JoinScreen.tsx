import { useState, type FormEvent } from 'react'
import type { ChatService, PresenceUser } from '../chat/contract'
import { cleanNickname, validateNickname } from '../lib/validation'

interface Props {
  service: ChatService
  /** typed 是使用者輸入的代號(不含自動加的 #2),用來記住 */
  onJoined: (typed: string, self: PresenceUser) => void
}

export function JoinScreen({ service, onJoined }: Props) {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const [joining, setJoining] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const clean = cleanNickname(value)
  const rule = validateNickname(clean)
  // 還沒輸入過就不要一開始顯示紅字
  const shownError = serverError ?? (touched && rule ? rule : null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (rule || joining) return
    setJoining(true)
    setServerError(null)
    try {
      const self = await service.join(clean)
      onJoined(clean, self)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '進入失敗,請再試一次')
      setJoining(false)
    }
  }

  return (
    <main className="join">
      <form className="join-card" onSubmit={submit} noValidate>
        <div className="join-mark" aria-hidden="true">
          <span className="dot" />
          <span>$ 連線中</span>
        </div>
        <h1>匿名聊天室</h1>
        <p className="join-lead">不用註冊、不用登入。取一個代號,就能和大家聊天。</p>

        <label className="field-label" htmlFor="nickname">
          你的代號
        </label>
        <div className="input-row">
          <span className="prompt" aria-hidden="true">
            &gt;
          </span>
          <input
            id="nickname"
            className="text-input"
            type="text"
            value={value}
            autoComplete="off"
            autoFocus
            placeholder="例如:小明"
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? 'nickname-error' : undefined}
            onChange={(e) => {
              setValue(e.target.value)
              setTouched(true)
              setServerError(null)
            }}
          />
        </div>
        <p id="nickname-error" className="field-error" role="alert">
          {shownError ?? ''}
        </p>

        <button className="btn btn-primary" type="submit" disabled={joining || !!rule}>
          {joining ? '進入中…' : '進入聊天室'}
        </button>
        <p className="join-hint">1 到 20 個字。如果有人用了一樣的代號,會自動在後面加編號。</p>
      </form>
    </main>
  )
}

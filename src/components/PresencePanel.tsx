import type { PresenceUser } from '../chat/contract'

interface Props {
  users: PresenceUser[]
  selfId: string
  open: boolean
}

/** 電腦版固定顯示在右側;手機版由 open 控制是否展開(CSS 負責切換) */
export function PresencePanel({ users, selfId, open }: Props) {
  return (
    <aside id="presence" className={`presence${open ? ' open' : ''}`} aria-label="線上名單">
      <h2 className="presence-title">-- {users.length} 人在線 --</h2>
      <ul>
        {users.map((u) => (
          <li key={u.userId}>
            <span className="dot" aria-hidden="true" />
            <span className="presence-name">{u.nickname}</span>
            {u.userId === selfId && <span className="you">你</span>}
          </li>
        ))}
      </ul>
    </aside>
  )
}

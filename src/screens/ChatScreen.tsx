import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  LEAVE_GRACE_MS,
  type ChatService,
  type ConnectionStatus,
  type Message,
  type PresenceUser,
} from '../chat/contract'
import { Composer } from '../components/Composer'
import { DebugPanel } from '../components/DebugPanel'
import { itemKey, MessageList, type TimelineItem } from '../components/MessageList'
import { ArrowDownIcon, ChevronDownIcon } from '../components/Icons'
import { PresencePanel } from '../components/PresencePanel'

interface Props {
  service: ChatService
  self: PresenceUser
  onLeave: () => void
}

const NEAR_BOTTOM_PX = 80

const showDebug = new URLSearchParams(window.location.search).get('debug') === '1'

const toItem = (message: Message): TimelineItem => ({ kind: 'msg', at: message.createdAt, message })

/** 把新項目併進去,以 id 去重,並依時間排序 */
function mergeItems(prev: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  const seen = new Set(prev.map(itemKey))
  const fresh = incoming.filter((i) => !seen.has(itemKey(i)))
  if (fresh.length === 0) return prev
  return [...prev, ...fresh].sort((a, b) => a.at - b.at)
}

export function ChatScreen({ service, self, onLeave }: Props) {
  const [items, setItems] = useState<TimelineItem[]>([])
  const [online, setOnline] = useState<PresenceUser[]>(() => service.getOnline())
  const [status, setStatus] = useState<ConnectionStatus>('connected')
  const [listOpen, setListOpen] = useState(false)
  const [hasNew, setHasNew] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const prevLen = useRef(0)
  const prevStatus = useRef<ConnectionStatus>('connected')
  const leaveTimers = useRef(new Map<string, number>())

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setHasNew(false)
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const history = await service.loadHistory()
      setItems((prev) => mergeItems(prev, history.map(toItem)))
    } catch {
      /* 讀取失敗就先維持現狀,連線狀態提示會告訴使用者 */
    }
  }, [service])

  useEffect(() => {
    const addNotice = (text: string) =>
      setItems((prev) =>
        mergeItems(prev, [{ kind: 'notice', at: Date.now(), id: crypto.randomUUID(), text }]),
      )
    const timers = leaveTimers.current

    const offs = [
      service.on('message:new', (m) => setItems((prev) => mergeItems(prev, [toItem(m)]))),
      service.on('presence:sync', (list) => setOnline(list)),
      service.on('presence:join', (user) => {
        setOnline(service.getOnline())
        // 對方剛剛才「離開」、又馬上回來(例如按了重新整理):兩個提示都不顯示
        const pending = timers.get(user.userId)
        if (pending !== undefined) {
          clearTimeout(pending)
          timers.delete(user.userId)
          return
        }
        if (user.userId !== self.userId) addNotice(`${user.nickname} 進來了`)
      }),
      service.on('presence:leave', ({ user, graceful }) => {
        setOnline(service.getOnline())
        const show = () => addNotice(`${user.nickname} 離開了`)
        if (graceful) {
          show()
        } else {
          // 非主動離開可能只是重新整理,延遲一下再提示
          timers.set(
            user.userId,
            window.setTimeout(() => {
              timers.delete(user.userId)
              show()
            }, LEAVE_GRACE_MS),
          )
        }
      }),
      service.on('connection:status', (s) => {
        const was = prevStatus.current
        prevStatus.current = s
        setStatus(s)
        // 斷線後連回來:重新讀一次最近的訊息,補上漏掉的
        if (s === 'connected' && was !== 'connected') {
          setOnline(service.getOnline())
          void loadHistory()
        }
      }),
    ]

    void loadHistory()
    return () => {
      offs.forEach((off) => off())
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [service, self.userId, loadHistory])

  // 新項目進來時決定要不要捲到底
  useLayoutEffect(() => {
    if (items.length <= prevLen.current) return
    const isFirstLoad = prevLen.current === 0
    prevLen.current = items.length
    const last = items[items.length - 1]
    const mine = last.kind === 'msg' && last.message.userId === self.userId
    if (isFirstLoad || atBottom.current || mine) {
      scrollToBottom()
    } else if (last.kind === 'msg') {
      setHasNew(true)
    }
  }, [items, self.userId, scrollToBottom])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    atBottom.current = near
    if (near) setHasNew(false)
  }

  const offline = status !== 'connected'

  return (
    <div className="chat">
      <header className="chat-header">
        <h1 className="chat-title">&gt; 匿名聊天室</h1>
        <button
          type="button"
          className="online-btn"
          aria-expanded={listOpen}
          aria-controls="presence"
          onClick={() => setListOpen((o) => !o)}
        >
          <span className="dot" aria-hidden="true" />
          {online.length} 人在線
          <span className="caret">
            <ChevronDownIcon size={14} />
          </span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={onLeave}>
          離開
        </button>
      </header>

      {offline && (
        <div className="banner" role="status">
          連線中斷,重新連線中…
        </div>
      )}

      <div className="chat-body">
        <main className="chat-main">
          <div className="message-scroll" ref={listRef} onScroll={onScroll}>
            <MessageList
              items={items}
              selfId={self.userId}
              onMediaLoad={() => atBottom.current && scrollToBottom()}
            />
          </div>
          {hasNew && (
            <button type="button" className="new-msg-btn" onClick={scrollToBottom}>
              有新訊息
              <ArrowDownIcon size={16} />
            </button>
          )}
        </main>
        <PresencePanel users={online} selfId={self.userId} open={listOpen} />
      </div>

      <Composer service={service} disabled={offline} />
      {showDebug && <DebugPanel service={service} />}
    </div>
  )
}

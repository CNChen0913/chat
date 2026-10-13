import { useEffect, useState } from 'react'
import { FILE_TTL_MS, type Message } from '../chat/contract'
import { formatSize, formatTime, isDisplayableImage } from '../lib/validation'
import { CloseIcon, FileIcon } from './Icons'

export type TimelineItem =
  | { kind: 'msg'; at: number; message: Message }
  | { kind: 'notice'; at: number; id: string; text: string }

export const itemKey = (item: TimelineItem): string =>
  item.kind === 'msg' ? item.message.id : item.id

interface Props {
  items: TimelineItem[]
  selfId: string
  onMediaLoad: () => void
}

export function MessageList({ items, selfId, onMediaLoad }: Props) {
  const [zoom, setZoom] = useState<string | null>(null)

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (items.length === 0) {
    return <p className="empty">還沒有人說話,來打個招呼吧</p>
  }

  return (
    <>
      <ol className="messages">
        {items.map((item, i) => {
          if (item.kind === 'notice') {
            return (
              <li key={item.id} className="notice">
                <span>-- {item.text} --</span>
              </li>
            )
          }
          const m = item.message
          const prev = items[i - 1]
          const mine = m.userId === selfId
          const grouped = prev?.kind === 'msg' && prev.message.userId === m.userId
          return (
            <li key={m.id} className={`msg ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`}>
              {!grouped && !mine && <span className="msg-name">{m.nickname}</span>}
              <div className="bubble">
                {m.file && (
                  <FileView message={m} onZoom={setZoom} onMediaLoad={onMediaLoad} />
                )}
                {m.body && <p className="msg-body">{m.body}</p>}
              </div>
              <time className="msg-time" dateTime={new Date(m.createdAt).toISOString()}>
                {formatTime(m.createdAt)}
              </time>
            </li>
          )
        })}
      </ol>

      {zoom && (
        <div className="lightbox" role="dialog" aria-label="圖片預覽" onClick={() => setZoom(null)}>
          <img src={zoom} alt="放大的圖片" />
          <button className="lightbox-close" type="button" aria-label="關閉預覽">
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </>
  )
}

function FileView({
  message,
  onZoom,
  onMediaLoad,
}: {
  message: Message
  onZoom: (url: string) => void
  onMediaLoad: () => void
}) {
  const file = message.file!
  const expired = !file.url || Date.now() - message.createdAt > FILE_TTL_MS

  if (expired) {
    return (
      <div className="file-chip expired" aria-label="檔案已過期">
        <span className="file-icon">
          <FileIcon size={26} />
        </span>
        <span className="file-meta">
          <span className="file-name">{file.name}</span>
          <span className="file-sub">檔案已過期</span>
        </span>
      </div>
    )
  }

  if (isDisplayableImage(file.type)) {
    return (
      <button type="button" className="image-btn" onClick={() => onZoom(file.url)} aria-label={`放大查看 ${file.name}`}>
        <img src={file.url} alt={file.name} loading="lazy" onLoad={onMediaLoad} />
      </button>
    )
  }

  return (
    <a className="file-chip" href={file.url} download={file.name} target="_blank" rel="noopener noreferrer">
      <span className="file-icon">
        <FileIcon size={26} />
      </span>
      <span className="file-meta">
        <span className="file-name">{file.name}</span>
        <span className="file-sub">{formatSize(file.size)} · 點擊下載</span>
      </span>
    </a>
  )
}

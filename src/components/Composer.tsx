import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { BODY_MAX, ChatError, RATE_LIMIT_MS, type ChatService } from '../chat/contract'
import { charCount, formatSize, isDisplayableImage, validateFile } from '../lib/validation'
import { CloseIcon, FileIcon, PaperclipIcon } from './Icons'

interface Props {
  service: ChatService
  /** 斷線等情況下不能送出 */
  disabled: boolean
}

const LOCK_SECONDS = Math.round(RATE_LIMIT_MS / 1000)

export function Composer({ service, disabled }: Props) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lockLeft, setLockLeft] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const wasLocked = useRef(false)

  // 手機(觸控裝置)Enter 是換行;電腦 Enter 送出
  const isTouch = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])

  const previewUrl = useMemo(
    () => (file && isDisplayableImage(file.type) ? URL.createObjectURL(file) : null),
    [file],
  )
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const count = charCount(text)
  const tooLong = count > BODY_MAX
  const uploading = progress !== null
  const locked = lockLeft > 0 || uploading
  const hasContent = text.trim().length > 0 || file !== null
  const canSend = !disabled && !locked && hasContent && !tooLong

  // 輸入框隨內容長高
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  }, [text])

  // 3 秒倒數
  useEffect(() => {
    if (lockLeft <= 0) return
    const t = setTimeout(() => setLockLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [lockLeft])

  // 解除鎖定後把游標放回輸入框
  useEffect(() => {
    if (locked) {
      wasLocked.current = true
    } else if (wasLocked.current) {
      wasLocked.current = false
      taRef.current?.focus()
    }
  }, [locked])

  async function send() {
    if (!canSend) return
    setError(null)
    setLockLeft(LOCK_SECONDS)
    const ac = new AbortController()
    abortRef.current = ac
    if (file) setProgress(0)
    try {
      await service.sendMessage(
        { body: text.trim() || undefined, file: file ?? undefined },
        { onProgress: setProgress, signal: ac.signal },
      )
      setText('')
      setFile(null)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setLockLeft(0)
      } else {
        // 失敗時輸入的內容保留,不會消失
        setError(err instanceof ChatError ? err.message : '送出失敗,請再試一次')
        if (!(err instanceof ChatError && err.code === 'RATE_LIMITED')) setLockLeft(0)
      }
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing:正在用注音等輸入法選字時,Enter 是「確認選字」,不能當送出
    if (e.key === 'Enter' && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return
    const problem = validateFile(f)
    if (problem) {
      setError(problem.message)
      setFile(null)
    } else {
      setError(null)
      setFile(f)
    }
  }

  const notice = error
    ? error
    : lockLeft > 0 && !uploading
      ? `請稍等一下(${lockLeft})`
      : disabled
        ? '連線中斷,暫時無法送出'
        : null

  return (
    <div className="composer">
      <div className="composer-status" role="status" aria-live="polite">
        {notice && <span className={error ? 'is-error' : ''}>{notice}</span>}
        {count >= BODY_MAX - 100 && (
          <span className={`counter${tooLong ? ' is-error' : ''}`}>
            {count}/{BODY_MAX}
          </span>
        )}
      </div>

      {file && (
        <div className="attachment">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="attachment-thumb" />
          ) : (
            <span className="file-icon">
              <FileIcon size={30} />
            </span>
          )}
          <span className="file-meta">
            <span className="file-name">{file.name}</span>
            <span className="file-sub">
              {uploading ? `上傳中 ${progress}%` : formatSize(file.size)}
            </span>
          </span>
          {uploading && (
            <progress className="upload-bar" max={100} value={progress ?? 0} aria-label="上傳進度" />
          )}
          <button
            type="button"
            className="btn-icon"
            aria-label={uploading ? '取消上傳' : '移除附件'}
            onClick={() => (uploading ? abortRef.current?.abort() : setFile(null))}
          >
            <CloseIcon size={18} />
          </button>
        </div>
      )}

      <div className="composer-row">
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="btn-icon attach"
          aria-label="附加檔案"
          disabled={disabled || locked}
          onClick={() => fileRef.current?.click()}
        >
          <PaperclipIcon size={22} />
        </button>
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <textarea
          ref={taRef}
          className="composer-input"
          rows={1}
          value={text}
          readOnly={locked}
          placeholder={disabled ? '連線中斷…' : '輸入訊息'}
          aria-label="訊息內容"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn btn-primary send" disabled={!canSend} onClick={() => void send()}>
          送出
        </button>
      </div>
    </div>
  )
}

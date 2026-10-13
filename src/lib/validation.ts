import {
  BODY_MAX,
  ERROR_MESSAGES,
  FILE_MAX_BYTES,
  NICKNAME_MAX,
  ChatError,
} from '../chat/contract'

// 控制字元與看不見的零寬字元
const INVISIBLE = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\ufeff]', 'g')

/** 以「字」計算長度,一個表情符號算一個字 */
export function charCount(text: string): number {
  return Array.from(text).length
}

export function cleanNickname(raw: string): string {
  return raw.replace(INVISIBLE, '').trim()
}

/** 回傳錯誤說明;合規則回傳 null。傳入的應該是 cleanNickname 之後的字串 */
export function validateNickname(clean: string): string | null {
  const n = charCount(clean)
  if (n < 1 || n > NICKNAME_MAX) return ERROR_MESSAGES.NICKNAME_INVALID
  return null
}

export function validateBody(body: string): ChatError | null {
  if (charCount(body) > BODY_MAX) return new ChatError('MESSAGE_TOO_LONG')
  return null
}

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'ps1', 'vbs', 'js', 'jar',
  'apk', 'app', 'dll', 'lnk', 'reg', 'wsf', 'hta', 'cpl', 'pif', 'gadget',
])

export function validateFile(file: File): ChatError | null {
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  if (BLOCKED_EXTENSIONS.has(ext)) return new ChatError('FILE_TYPE_BLOCKED')
  if (file.size > FILE_MAX_BYTES) return new ChatError('FILE_TOO_LARGE')
  return null
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'])

/** 只有這些類型才當圖片直接顯示,其他一律當成下載檔案 */
export function isDisplayableImage(type: string): boolean {
  return IMAGE_TYPES.has(type)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

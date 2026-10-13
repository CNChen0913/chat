// 聊天服務合約(對應 docs/architecture.md 第 5 節)。
// 所有畫面只認這個檔案;階段一由 mockChatService 實作,階段二由 supabaseChatService 實作。

export const NICKNAME_MAX = 20
export const BODY_MAX = 500
export const FILE_MAX_BYTES = 5 * 1024 * 1024
export const RATE_LIMIT_MS = 3000
export const FILE_TTL_MS = 24 * 60 * 60 * 1000
export const HISTORY_LIMIT = 50
export const LEAVE_GRACE_MS = 5000

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

export interface FileInfo {
  url: string
  name: string
  type: string
  size: number
}

export interface Message {
  id: string
  userId: string
  nickname: string
  body?: string
  file?: FileInfo
  /** 毫秒時間戳。階段二以伺服器時間為準 */
  createdAt: number
}

export interface PresenceUser {
  userId: string
  nickname: string
  joinedAt: number
}

export type ChatErrorCode =
  | 'NICKNAME_INVALID'
  | 'MESSAGE_EMPTY'
  | 'MESSAGE_TOO_LONG'
  | 'RATE_LIMITED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_BLOCKED'
  | 'NETWORK'

export const ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  NICKNAME_INVALID: `代號需為 1 到 ${NICKNAME_MAX} 個字`,
  MESSAGE_EMPTY: '請輸入內容',
  MESSAGE_TOO_LONG: `訊息最多 ${BODY_MAX} 字`,
  RATE_LIMITED: '請稍等一下',
  FILE_TOO_LARGE: '檔案太大,上限 5 MB',
  FILE_TYPE_BLOCKED: '不支援這種檔案',
  NETWORK: '連線有問題,請稍後再試',
}

export class ChatError extends Error {
  code: ChatErrorCode
  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code])
    this.name = 'ChatError'
    this.code = code
  }
}

export interface ChatEvents {
  'message:new': Message
  'presence:sync': PresenceUser[]
  'presence:join': PresenceUser
  /** graceful 為 true 表示對方按了「離開」;false 表示斷線或關閉網頁 */
  'presence:leave': { user: PresenceUser; graceful: boolean }
  'connection:status': ConnectionStatus
}

export interface SendInput {
  body?: string
  file?: File
}

export interface SendOptions {
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export interface ChatService {
  /** 以代號進入,回傳實際使用的代號(可能被加上 #2) */
  join(nickname: string): Promise<PresenceUser>
  leave(): void
  sendMessage(input: SendInput, options?: SendOptions): Promise<void>
  /** 最近 HISTORY_LIMIT 則,由舊到新 */
  loadHistory(): Promise<Message[]>
  getOnline(): PresenceUser[]
  on<E extends keyof ChatEvents>(event: E, handler: (payload: ChatEvents[E]) => void): () => void
  /** 只有階段一的假服務才有,用來手動測試斷線 */
  debug?: { setOffline(offline: boolean): void; isOffline(): boolean }
}

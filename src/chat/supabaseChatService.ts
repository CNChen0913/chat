// 階段二:真的聊天服務,連到 Supabase。遵守 contract.ts 的合約,畫面完全不用知道差別。
//
// - 匿名身分:Supabase Auth 的匿名登入(背景自動進行,使用者看不到)
// - 訊息:存進 messages 資料表,新訊息由 Realtime 的「資料庫變動通知」推送
// - 線上名單:Realtime 的 Presence
// - 檔案:Storage 的 chat-files(以小時資料夾存放,24 小時後由排程刪除)

import {
  createClient,
  type RealtimeChannel,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import {
  ChatError,
  HISTORY_LIMIT,
  RATE_LIMIT_MS,
  type ChatEvents,
  type ChatService,
  type ConnectionStatus,
  type FileInfo,
  type Message,
  type PresenceUser,
  type SendInput,
  type SendOptions,
} from './contract'
import {
  cleanNickname,
  isDisplayableImage,
  validateBody,
  validateFile,
  validateNickname,
} from '../lib/validation'

const BUCKET = 'chat-files'
const ROOM = 'chat-room'
const JOIN_TIMEOUT_MS = 10_000
const PRESENCE_WAIT_MS = 1_500

type Handler<E extends keyof ChatEvents> = (payload: ChatEvents[E]) => void

interface MessageRow {
  id: string
  user_id: string
  nickname: string
  body: string | null
  file_path: string | null
  file_name: string | null
  file_type: string | null
  file_size: number | null
  created_at: string
}

type PresenceMeta = PresenceUser

/** 檔案路徑用 ASCII 的副檔名(原始檔名另存在資料表裡) */
function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin'
}

function hourFolder(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}`
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown }
    return `${String(e.message ?? '')} ${String(e.details ?? '')}`
  }
  return String(err ?? '')
}

/** 把資料庫的錯誤轉成合約裡的錯誤 */
function mapInsertError(err: unknown): ChatError {
  const text = errorText(err)
  if (text.includes('RATE_LIMITED')) return new ChatError('RATE_LIMITED')
  if (text.includes('messages_body_len')) return new ChatError('MESSAGE_TOO_LONG')
  if (text.includes('messages_has_content')) return new ChatError('MESSAGE_EMPTY')
  if (text.includes('messages_file_name_not_executable')) return new ChatError('FILE_TYPE_BLOCKED')
  if (text.includes('messages_file_size')) return new ChatError('FILE_TOO_LARGE')
  return new ChatError('NETWORK')
}

export class SupabaseChatService implements ChatService {
  private readonly supabase: SupabaseClient
  private listeners: { [E in keyof ChatEvents]?: Set<Handler<E>> } = {}

  private channel: RealtimeChannel | null = null
  private self: PresenceUser | null = null
  private session: Session | null = null
  private lastSentAt = 0

  /** 目前已知的線上使用者(用來比對誰進來、誰離開) */
  private known = new Map<string, PresenceUser>()
  private presenceReady = false
  /** 對方按「離開」時會先廣播一聲,收到的人才知道是主動離開 */
  private bye = new Set<string>()
  private leaving = false
  private status: ConnectionStatus = 'connecting'
  /** 使用者輸入的代號(不含自動加的編號) */
  private baseNickname = ''

  private readonly onOffline = () => this.setStatus('reconnecting')
  // 網路回來:若連線其實沒斷就直接恢復;斷了的話,Realtime 重連成功後 onResubscribed 會通知 connected
  private readonly onOnline = () => {
    if (this.channel?.state === 'joined') this.setStatus('connected')
  }

  constructor(url: string, publishableKey: string) {
    this.supabase = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }

  // ---- 合約 ----

  async join(raw: string): Promise<PresenceUser> {
    const nickname = cleanNickname(raw)
    const err = validateNickname(nickname)
    if (err) throw new ChatError('NICKNAME_INVALID', err)

    const userId = await this.ensureSession()
    this.teardown()
    this.leaving = false
    this.presenceReady = false
    this.known.clear()
    this.bye.clear()

    const channel = this.supabase.channel(ROOM, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    })
    this.channel = channel

    channel
      .on('presence', { event: 'sync' }, () => this.onPresenceSync())
      .on('broadcast', { event: 'bye' }, ({ payload }) => {
        const id = (payload as { userId?: string } | null)?.userId
        if (id) this.bye.add(id)
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => this.emit('message:new', this.toMessage(payload.new as MessageRow)),
      )

    // 等頻道連上,並等第一次收到線上名單(才能判斷代號有沒有重複)
    const firstSync = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, PRESENCE_WAIT_MS)
      const off = this.on('presence:sync', () => {
        clearTimeout(t)
        off()
        resolve()
      })
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ChatError('NETWORK')), JOIN_TIMEOUT_MS)
      let first = true
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (first) {
            first = false
            clearTimeout(timer)
            resolve()
          } else {
            this.onResubscribed()
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (first) {
            clearTimeout(timer)
            reject(new ChatError('NETWORK'))
          } else if (!this.leaving) {
            this.setStatus('reconnecting')
          }
        }
      })
    }).catch((e) => {
      this.teardown()
      throw e
    })

    await firstSync

    // 其他人(不含自己上一次還沒消失的紀錄,例如剛按了重新整理)已經用掉的代號
    const taken = new Set(
      [...this.known.values()].filter((u) => u.userId !== userId).map((u) => u.nickname),
    )
    let unique = nickname
    for (let n = 2; taken.has(unique); n++) unique = `${nickname}#${n}`

    const self: PresenceUser = { userId, nickname: unique, joinedAt: Date.now() }
    this.self = self
    const tracked = await channel.track(self)
    if (tracked !== 'ok') {
      this.teardown()
      throw new ChatError('NETWORK')
    }

    this.baseNickname = nickname
    // 線上名單從別人那邊傳到這裡可能要花一兩秒,所以兩個人幾乎同時用同一個代號進來時,
    // 上面的檢查可能都沒看到對方。之後每次名單更新都會再檢查一次(見 resolveNameConflict)。
    this.resolveNameConflict()

    window.addEventListener('offline', this.onOffline)
    window.addEventListener('online', this.onOnline)
    this.setStatus('connected')
    this.emit('presence:sync', this.getOnline())
    return self
  }

  leave(): void {
    const channel = this.channel
    const self = this.self
    this.leaving = true
    if (channel && self) {
      // 先廣播「我是主動離開」,再取消線上狀態
      void channel
        .send({ type: 'broadcast', event: 'bye', payload: { userId: self.userId } })
        .finally(() => void channel.untrack().finally(() => this.supabase.removeChannel(channel)))
    } else if (channel) {
      void this.supabase.removeChannel(channel)
    }
    this.channel = null
    this.self = null
    this.known.clear()
    window.removeEventListener('offline', this.onOffline)
    window.removeEventListener('online', this.onOnline)
  }

  async sendMessage(input: SendInput, options: SendOptions = {}): Promise<void> {
    const self = this.self
    if (!self || !this.session) throw new ChatError('NETWORK')

    const body = (input.body ?? '').trim()
    if (!body && !input.file) throw new ChatError('MESSAGE_EMPTY')
    const bodyErr = validateBody(body)
    if (bodyErr) throw bodyErr
    if (input.file) {
      const fileErr = validateFile(input.file)
      if (fileErr) throw fileErr
    }
    if (Date.now() - this.lastSentAt < RATE_LIMIT_MS) throw new ChatError('RATE_LIMITED')

    let file: { path: string; name: string; type: string; size: number } | null = null
    if (input.file) {
      const path = `${hourFolder(new Date())}/${self.userId}-${crypto.randomUUID()}.${safeExtension(input.file.name)}`
      const type = input.file.type || 'application/octet-stream'
      await this.upload(path, input.file, type, options)
      file = { path, name: input.file.name, type, size: input.file.size }
    }

    const { data, error } = await this.supabase
      .from('messages')
      .insert({
        nickname: self.nickname,
        body: body || null,
        file_path: file?.path ?? null,
        file_name: file?.name ?? null,
        file_type: file?.type ?? null,
        file_size: file?.size ?? null,
      })
      .select('*')
      .single()
    if (error || !data) throw mapInsertError(error)

    this.lastSentAt = Date.now()
    // 自己的訊息不用乾等即時通知(畫面會用訊息編號去重,不會顯示兩次)
    this.emit('message:new', this.toMessage(data as MessageRow))
  }

  async loadHistory(): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (error) throw new ChatError('NETWORK')
    return (data as MessageRow[]).reverse().map((row) => this.toMessage(row))
  }

  getOnline(): PresenceUser[] {
    const list = new Map(this.known)
    // 剛按下進入、線上名單還沒回來時,至少要看得到自己
    if (this.self) list.set(this.self.userId, this.known.get(this.self.userId) ?? this.self)
    return [...list.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  }

  on<E extends keyof ChatEvents>(event: E, handler: Handler<E>): () => void {
    let set = this.listeners[event] as Set<Handler<E>> | undefined
    if (!set) {
      set = new Set()
      ;(this.listeners as Record<string, unknown>)[event] = set
    }
    const target = set
    target.add(handler)
    return () => {
      target.delete(handler)
    }
  }

  // ---- 內部 ----

  private emit<E extends keyof ChatEvents>(event: E, payload: ChatEvents[E]): void {
    const set = this.listeners[event] as Set<Handler<E>> | undefined
    set?.forEach((h) => h(payload))
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.emit('connection:status', status)
  }

  /** 取得匿名身分:瀏覽器已經有就沿用(重新整理後還是同一個人),沒有才向 Supabase 要一個 */
  private async ensureSession(): Promise<string> {
    try {
      const { data } = await this.supabase.auth.getSession()
      let session = data.session
      if (!session) {
        const res = await this.supabase.auth.signInAnonymously()
        if (res.error || !res.data.session) throw new ChatError('NETWORK')
        session = res.data.session
      }
      this.session = session
      return session.user.id
    } catch (e) {
      throw e instanceof ChatError ? e : new ChatError('NETWORK')
    }
  }

  private teardown(): void {
    if (this.channel) void this.supabase.removeChannel(this.channel)
    this.channel = null
    this.self = null
    window.removeEventListener('offline', this.onOffline)
    window.removeEventListener('online', this.onOnline)
  }

  /** 線上名單有變動:比對前後差異,通知誰進來、誰離開 */
  private onPresenceSync(): void {
    if (!this.channel) return
    const state = this.channel.presenceState<PresenceMeta>()
    const current = new Map<string, PresenceUser>()
    for (const [key, metas] of Object.entries(state)) {
      const meta = metas[metas.length - 1]
      if (meta) current.set(key, { userId: meta.userId, nickname: meta.nickname, joinedAt: meta.joinedAt })
    }

    const previous = this.known
    this.known = current
    this.resolveNameConflict()

    // 第一次收到名單時,只更新名單,不把每個人都當成「剛進來」
    if (this.presenceReady) {
      for (const [key, user] of current) {
        if (!previous.has(key)) this.emit('presence:join', user)
      }
      for (const [key, user] of previous) {
        if (!current.has(key)) {
          const graceful = this.bye.delete(key)
          this.emit('presence:leave', { user, graceful })
        }
      }
    }
    this.presenceReady = true
    // 每次名單有變動都通知畫面更新(例如有人因為同名改成 #2,人數沒變但名字變了)
    this.emit('presence:sync', this.getOnline())
  }

  /**
   * 如果有別人用了跟自己一樣的代號、而且比自己早進來,自己就改用下一個編號。
   * 雙方看到的是同樣的資料,所以只有比較晚的那一位會改。
   */
  private resolveNameConflict(): void {
    const self = this.self
    const channel = this.channel
    if (!self || !channel) return
    const others = [...this.known.values()].filter((u) => u.userId !== self.userId)
    const earlier = others.some(
      (u) =>
        u.nickname === self.nickname &&
        (u.joinedAt < self.joinedAt || (u.joinedAt === self.joinedAt && u.userId < self.userId)),
    )
    if (!earlier) return
    const used = new Set(others.map((u) => u.nickname))
    let next = this.baseNickname
    for (let n = 2; used.has(next); n++) next = `${this.baseNickname}#${n}`
    self.nickname = next
    void channel.track(self)
  }

  /** 斷線後重新連上:重新送出自己的線上狀態,並通知畫面已連線 */
  private onResubscribed(): void {
    if (this.leaving) return
    if (this.self && this.channel) void this.channel.track(this.self)
    this.setStatus('connected')
  }

  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname,
      createdAt: new Date(row.created_at).getTime(),
      ...(row.body ? { body: row.body } : {}),
      ...(row.file_path ? { file: this.toFile(row) } : {}),
    }
  }

  private toFile(row: MessageRow): FileInfo {
    const name = row.file_name ?? 'file'
    const type = row.file_type ?? 'application/octet-stream'
    // 圖片直接顯示;其他檔案加上 download,瀏覽器會用原始檔名下載
    const { data } = this.supabase.storage
      .from(BUCKET)
      .getPublicUrl(row.file_path!, isDisplayableImage(type) ? undefined : { download: name })
    return { url: data.publicUrl, name, type, size: row.file_size ?? 0 }
  }

  /** 上傳檔案並回報真實的上傳進度(supabase-js 沒有提供進度,所以直接呼叫 Storage 的網址) */
  private upload(path: string, file: File, type: string, options: SendOptions): Promise<void> {
    const token = this.session?.access_token
    const base = (this.supabase as unknown as { supabaseUrl: string }).supabaseUrl
    const key = (this.supabase as unknown as { supabaseKey: string }).supabaseKey
    if (!token) return Promise.reject(new ChatError('NETWORK'))

    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      xhr.open('POST', `${base}/storage/v1/object/${BUCKET}/${encoded}`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', key)
      xhr.setRequestHeader('Content-Type', type)
      xhr.setRequestHeader('x-upsert', 'false')

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) options.onProgress?.(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          options.onProgress?.(100)
          resolve()
        } else if (xhr.status === 413) {
          reject(new ChatError('FILE_TOO_LARGE'))
        } else if (xhr.status === 400 || xhr.status === 403) {
          // 儲存空間的規則拒絕(例如可執行檔)
          reject(new ChatError('FILE_TYPE_BLOCKED'))
        } else {
          reject(new ChatError('NETWORK'))
        }
      }
      xhr.onerror = () => reject(new ChatError('NETWORK'))
      xhr.onabort = () => reject(new DOMException('已取消', 'AbortError'))

      const signal = options.signal
      if (signal) {
        if (signal.aborted) return reject(new DOMException('已取消', 'AbortError'))
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }
      options.onProgress?.(0)
      xhr.send(file)
    })
  }
}

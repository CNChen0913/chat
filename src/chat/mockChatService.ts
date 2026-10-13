// 階段一:假的聊天服務。所有資料都在瀏覽器裡模擬,沒有任何網路連線。
// 由幾位機器人使用者自動發言與進出;同一個瀏覽器開兩個分頁可以互相聊天。

import {
  ChatError,
  HISTORY_LIMIT,
  RATE_LIMIT_MS,
  type ChatEvents,
  type ChatService,
  type ConnectionStatus,
  type Message,
  type PresenceUser,
  type SendInput,
  type SendOptions,
} from './contract'
import { cleanNickname, validateBody, validateFile, validateNickname } from '../lib/validation'

type Handler<E extends keyof ChatEvents> = (payload: ChatEvents[E]) => void

type ChannelMsg =
  | { type: 'msg'; message: Message }
  | { type: 'join'; user: PresenceUser }
  | { type: 'leave'; user: PresenceUser; graceful: boolean }
  | { type: 'who' }

const BOT_NAMES = ['阿花', 'Kevin', '小美', '路人乙', 'Mia']
const BOT_PHRASES = [
  '大家晚安~',
  '今天好累喔',
  '有人看過昨天那部影集嗎?',
  '哈哈哈哈哈',
  '我剛下班,吃飯了沒?',
  '推薦一下好聽的歌',
  '這裡好安靜,來聊聊吧',
  '週末有人要出去玩嗎',
  '我覺得咖啡比茶好喝 ☕',
  '真的假的!',
  '笑死',
  '等一下,我查一下',
  '有人會用 Excel 嗎?',
  '好喔,沒問題 👍',
  '下雨了,大家有帶傘嗎 🌧️',
  '晚點再說~',
]

const DEMO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6b26b"/>' +
  '<stop offset="1" stop-color="#d4577c"/></linearGradient></defs>' +
  '<rect width="480" height="300" fill="url(#g)"/><circle cx="360" cy="90" r="46" fill="#fff6d6"/>' +
  '<path d="M0 300 L150 140 L250 230 L330 170 L480 300 Z" fill="#3a2b52"/></svg>'
const DEMO_IMAGE_URL = `data:image/svg+xml;utf8,${encodeURIComponent(DEMO_SVG)}`
const DEMO_TEXT_URL = `data:text/plain;charset=utf-8,${encodeURIComponent('這是示範檔案。')}`

const HISTORY_KEEP = 200

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 每個分頁一個匿名編號(階段二會換成 Supabase 的匿名身分) */
function loadAnonId(): string {
  try {
    let id = sessionStorage.getItem('chat.anonId')
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem('chat.anonId', id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export class MockChatService implements ChatService {
  private listeners: { [E in keyof ChatEvents]?: Set<Handler<E>> } = {}
  private users = new Map<string, PresenceUser>()
  private bots: PresenceUser[] = BOT_NAMES.map((name) => ({
    userId: `bot-${name}`,
    nickname: name,
    joinedAt: Date.now() - randomBetween(10, 90) * 60_000,
  }))
  private history: Message[] = []
  private self: PresenceUser | null = null
  private offline = false
  private lastSentAt = 0
  private botTimers: number[] = []
  private channel: BroadcastChannel | null = null
  private readonly anonId = loadAnonId()

  constructor() {
    // 一開始上線的機器人:前三位
    for (const bot of this.bots.slice(0, 3)) this.users.set(bot.userId, bot)
    this.history = this.seedHistory()

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('chat-mock')
      this.channel.onmessage = (e: MessageEvent<ChannelMsg>) => this.onChannel(e.data)
      window.addEventListener('pagehide', () => {
        if (this.self) this.post({ type: 'leave', user: this.self, graceful: false })
      })
    }
  }

  // ---- 合約 ----

  async join(raw: string): Promise<PresenceUser> {
    const nickname = cleanNickname(raw)
    const err = validateNickname(nickname)
    if (err) throw new ChatError('NICKNAME_INVALID', err)

    await sleep(250)
    // 問問其他分頁有誰在線,才能判斷代號是否重複
    this.post({ type: 'who' })
    await sleep(150)

    const taken = new Set([...this.users.values()].map((u) => u.nickname))
    let unique = nickname
    for (let n = 2; taken.has(unique); n++) unique = `${nickname}#${n}`

    const self: PresenceUser = { userId: this.anonId, nickname: unique, joinedAt: Date.now() }
    this.self = self
    this.users.set(self.userId, self)
    this.post({ type: 'join', user: self })
    this.startBots()

    this.setStatus('connected')
    this.emit('presence:sync', this.getOnline())
    return self
  }

  leave(): void {
    if (!this.self) return
    this.post({ type: 'leave', user: this.self, graceful: true })
    this.users.delete(this.self.userId)
    this.self = null
    this.stopBots()
    this.offline = false
  }

  async sendMessage(input: SendInput, options: SendOptions = {}): Promise<void> {
    if (!this.self || this.offline) throw new ChatError('NETWORK')

    const body = (input.body ?? '').trim()
    if (!body && !input.file) throw new ChatError('MESSAGE_EMPTY')
    const bodyErr = validateBody(body)
    if (bodyErr) throw bodyErr
    if (input.file) {
      const fileErr = validateFile(input.file)
      if (fileErr) throw fileErr
    }
    if (Date.now() - this.lastSentAt < RATE_LIMIT_MS) throw new ChatError('RATE_LIMITED')

    if (input.file) {
      // 模擬上傳進度
      for (let p = 0; p <= 100; p += 20) {
        if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
        options.onProgress?.(p)
        await sleep(120)
      }
    }
    if (this.offline) throw new ChatError('NETWORK')
    const self = this.self
    if (!self) throw new ChatError('NETWORK')

    this.lastSentAt = Date.now()
    const message: Message = {
      id: crypto.randomUUID(),
      userId: self.userId,
      nickname: self.nickname,
      createdAt: Date.now(),
      ...(body ? { body } : {}),
      ...(input.file
        ? {
            file: {
              url: URL.createObjectURL(input.file),
              name: input.file.name,
              type: input.file.type || 'application/octet-stream',
              size: input.file.size,
            },
          }
        : {}),
    }
    this.pushHistory(message)
    this.post({ type: 'msg', message })
    this.emit('message:new', message)
  }

  async loadHistory(): Promise<Message[]> {
    await sleep(150)
    return this.history.slice(-HISTORY_LIMIT)
  }

  getOnline(): PresenceUser[] {
    return [...this.users.values()].sort((a, b) => a.joinedAt - b.joinedAt)
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

  debug = {
    setOffline: (offline: boolean) => {
      if (offline === this.offline || !this.self) return
      this.offline = offline
      if (offline) {
        this.setStatus('reconnecting')
      } else {
        // 連回來:先通知已連線,畫面會自己重新讀歷史補上漏掉的訊息
        this.setStatus('connected')
        this.emit('presence:sync', this.getOnline())
      }
    },
    isOffline: () => this.offline,
  }

  // ---- 內部 ----

  private emit<E extends keyof ChatEvents>(event: E, payload: ChatEvents[E]): void {
    // 斷線期間不通知畫面(漏掉的訊息要等連回後靠 loadHistory 補)
    if (this.offline && event !== 'connection:status') return
    const set = this.listeners[event] as Set<Handler<E>> | undefined
    set?.forEach((h) => h(payload))
  }

  private setStatus(status: ConnectionStatus): void {
    this.emit('connection:status', status)
  }

  private post(msg: ChannelMsg): void {
    this.channel?.postMessage(msg)
  }

  private onChannel(msg: ChannelMsg): void {
    switch (msg.type) {
      case 'who':
        if (this.self) this.post({ type: 'join', user: this.self })
        break
      case 'msg':
        this.pushHistory(msg.message)
        this.emit('message:new', msg.message)
        break
      case 'join': {
        const known = this.users.has(msg.user.userId)
        this.users.set(msg.user.userId, msg.user)
        // 對方回覆 who 時也會送 join,已經知道的就不重複通知
        if (!known && this.self) this.emit('presence:join', msg.user)
        break
      }
      case 'leave':
        if (this.users.delete(msg.user.userId) && this.self) {
          this.emit('presence:leave', { user: msg.user, graceful: msg.graceful })
        }
        break
    }
  }

  private pushHistory(message: Message): void {
    this.history.push(message)
    if (this.history.length > HISTORY_KEEP) this.history.splice(0, this.history.length - HISTORY_KEEP)
  }

  private botSay(bot: PresenceUser): void {
    const message: Message = {
      id: crypto.randomUUID(),
      userId: bot.userId,
      nickname: bot.nickname,
      body: pick(BOT_PHRASES),
      createdAt: Date.now(),
    }
    this.pushHistory(message)
    this.emit('message:new', message)
  }

  private startBots(): void {
    this.stopBots()
    const talk = () => {
      const online = this.bots.filter((b) => this.users.has(b.userId))
      if (online.length > 0) this.botSay(pick(online))
      this.botTimers.push(window.setTimeout(talk, randomBetween(4000, 9000)))
    }
    const churn = () => {
      const online = this.bots.filter((b) => this.users.has(b.userId))
      const away = this.bots.filter((b) => !this.users.has(b.userId))
      if (away.length > 0 && (online.length < 2 || Math.random() < 0.5)) {
        const bot = { ...pick(away), joinedAt: Date.now() }
        this.users.set(bot.userId, bot)
        this.emit('presence:join', bot)
      } else if (online.length > 1) {
        const bot = pick(online)
        this.users.delete(bot.userId)
        this.emit('presence:leave', { user: bot, graceful: Math.random() < 0.6 })
      }
      this.botTimers.push(window.setTimeout(churn, randomBetween(20_000, 35_000)))
    }
    this.botTimers.push(window.setTimeout(talk, randomBetween(2500, 5000)))
    this.botTimers.push(window.setTimeout(churn, randomBetween(12_000, 20_000)))
  }

  private stopBots(): void {
    this.botTimers.forEach((t) => clearTimeout(t))
    this.botTimers = []
  }

  private seedHistory(): Message[] {
    const now = Date.now()
    const out: Message[] = []
    const make = (bot: PresenceUser, createdAt: number, extra: Partial<Message>): Message => ({
      id: crypto.randomUUID(),
      userId: bot.userId,
      nickname: bot.nickname,
      createdAt,
      ...extra,
    })

    // 兩則超過 24 小時的檔案訊息,用來看「檔案已過期」的樣子
    const oldAt = now - 25 * 3600_000
    out.push(
      make(this.bots[0], oldAt, {
        body: '昨天的簡報檔',
        file: { url: '', name: '簡報.pdf', type: 'application/pdf', size: 2_400_000 },
      }),
      make(this.bots[1], oldAt + 60_000, {
        file: { url: '', name: '現場照片.jpg', type: 'image/jpeg', size: 1_800_000 },
      }),
    )

    const count = HISTORY_LIMIT - out.length
    for (let i = 0; i < count; i++) {
      // 偶爾讓同一個人連續發兩則,方便看連續訊息的排版
      const prev = out[out.length - 1]
      const bot =
        i > 2 && Math.random() < 0.25
          ? (this.bots.find((b) => b.userId === prev.userId) ?? pick(this.bots))
          : pick(this.bots)
      const createdAt = now - (count - i) * randomBetween(2, 4) * 60_000
      if (i === count - 12) {
        out.push(
          make(bot, createdAt, {
            body: '看我拍的夕陽',
            file: { url: DEMO_IMAGE_URL, name: '夕陽.svg', type: 'image/svg+xml', size: 1_200 },
          }),
        )
      } else if (i === count - 6) {
        out.push(
          make(bot, createdAt, {
            file: { url: DEMO_TEXT_URL, name: '備忘.txt', type: 'text/plain', size: 24 },
          }),
        )
      } else {
        out.push(make(bot, createdAt, { body: pick(BOT_PHRASES) }))
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }
}

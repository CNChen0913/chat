// 選擇現在使用哪一個聊天服務。
// - 有設定 Supabase 的網址與公開金鑰(VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY)→ 真的聊天服務
// - 沒設定,或網址帶 ?mock=1 → 假的聊天服務(機器人,用來展示與測試)
import { MockChatService } from './mockChatService'
import { SupabaseChatService } from './supabaseChatService'
import type { ChatService } from './contract'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const forceMock = new URLSearchParams(window.location.search).get('mock') === '1'

export const chatService: ChatService =
  url && key && !forceMock ? new SupabaseChatService(url, key) : new MockChatService()

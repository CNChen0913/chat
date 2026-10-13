// 選擇現在使用哪一個聊天服務。階段二接上 Supabase 時,只需要改這一個檔案。
import { MockChatService } from './mockChatService'
import type { ChatService } from './contract'

export const chatService: ChatService = new MockChatService()

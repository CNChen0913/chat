# CLAUDE.md

一個不用登入的匿名聊天室,網頁放在 GitHub Pages,即時傳訊用 Supabase。

## 規則

- 開始任何工作前,先讀 `docs/architecture.md`。
- 目前在**階段二**:接上 Supabase。階段一的前端與假服務(`src/chat/mockChatService.ts`)已完成;真服務是 `src/chat/supabaseChatService.ts`,Supabase 的 SQL 與小程式在 `supabase/`。不使用 Supabase CLI。
- 不可以把金鑰檔案 commit 進 git(`.env`、`.env.local`、`.env.*.local` 等)。只有沒有真實值的 `.env.example` 可以 commit。每次 commit 前先檢查變更清單。

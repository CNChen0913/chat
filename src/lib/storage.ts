// 把使用者最後用的代號記在瀏覽器裡,重新整理後才能自動回到聊天室。
// 讀寫都包 try/catch:無痕視窗或封鎖網站資料時可能失敗,失敗就當作沒有記住。

const KEY = 'chat.nickname'

export function loadNickname(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(KEY, nickname)
  } catch {
    /* 忽略 */
  }
}

export function clearNickname(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}

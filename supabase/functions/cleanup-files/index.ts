// cleanup-files:刪除 chat-files 裡超過 24 小時的檔案。
// 檔案以「小時資料夾」存放(例如 2026101309),所以只要刪掉比「24 小時前那一小時」更早的整個資料夾。
// 在 Supabase 後台 Edge Functions 的編輯器貼上並部署,名稱必須是 cleanup-files。
//
// 管理員權限由 Supabase 自動提供給 Edge Function(環境變數),不需要把任何秘密金鑰貼進來。

import { createClient } from 'npm:@supabase/supabase-js@2'

const BUCKET = 'chat-files'
const TTL_HOURS = 24

function hourFolder(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}`
}

function pickSecretKey(): string {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (dict) {
    try {
      const values = Object.values(JSON.parse(dict) as Record<string, string>)
      if (values.length > 0) return values[0]
    } catch {
      // 格式不如預期時,改用舊版的環境變數
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('找不到函式可用的管理員金鑰')
  return legacy
}

Deno.serve(async () => {
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, pickSecretKey(), {
      auth: { persistSession: false },
    })
    const storage = supabase.storage.from(BUCKET)
    const cutoff = hourFolder(new Date(Date.now() - TTL_HOURS * 3600_000))

    const { data: folders, error: listError } = await storage.list('', { limit: 1000 })
    if (listError) throw listError

    // 只處理看起來像小時資料夾的名稱,而且比 cutoff 更早
    const expired = (folders ?? [])
      .map((f) => f.name)
      .filter((name) => /^[0-9]{10}$/.test(name) && name < cutoff)

    let deleted = 0
    for (const folder of expired) {
      // 一個資料夾可能有很多檔案,分批刪到空為止
      for (;;) {
        const { data: files, error } = await storage.list(folder, { limit: 100 })
        if (error) throw error
        if (!files || files.length === 0) break
        const { error: removeError } = await storage.remove(files.map((f) => `${folder}/${f.name}`))
        if (removeError) throw removeError
        deleted += files.length
      }
    }

    return new Response(JSON.stringify({ ok: true, cutoff, folders: expired.length, deleted }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

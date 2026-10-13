import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 的網址是 https://<帳號>.github.io/chat/,
// 所以正式打包時網頁檔案要放在 /chat/ 這個子路徑下;本機開發則用根路徑。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/chat/' : '/',
  plugins: [react()],
}))

import { useState } from 'react'
import type { ChatService } from '../chat/contract'

/** 只在階段一、且網址帶 ?debug=1 時出現:手動模擬斷線與連回 */
export function DebugPanel({ service }: { service: ChatService }) {
  const [offline, setOffline] = useState(service.debug?.isOffline() ?? false)
  if (!service.debug) return null
  const debug = service.debug
  return (
    <div className="debug-panel">
      <span>測試</span>
      <button
        type="button"
        onClick={() => {
          debug.setOffline(!offline)
          setOffline(!offline)
        }}
      >
        {offline ? '模擬連回' : '模擬斷線'}
      </button>
    </div>
  )
}

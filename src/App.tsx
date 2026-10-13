import { useEffect, useState } from 'react'
import { chatService } from './chat'
import type { PresenceUser } from './chat/contract'
import { clearNickname, loadNickname, saveNickname } from './lib/storage'
import { ChatScreen } from './screens/ChatScreen'
import { JoinScreen } from './screens/JoinScreen'

type Phase = { name: 'boot' } | { name: 'join' } | { name: 'chat'; self: PresenceUser }

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'boot' })

  // 瀏覽器記著上次的代號就直接進入聊天室
  useEffect(() => {
    const saved = loadNickname()
    if (!saved) {
      setPhase({ name: 'join' })
      return
    }
    chatService
      .join(saved)
      .then((self) => setPhase({ name: 'chat', self }))
      .catch(() => {
        clearNickname()
        setPhase({ name: 'join' })
      })
  }, [])

  if (phase.name === 'boot') {
    return (
      <div className="boot" role="status">
        載入中…
      </div>
    )
  }

  if (phase.name === 'join') {
    return (
      <JoinScreen
        service={chatService}
        onJoined={(typed, self) => {
          saveNickname(typed)
          setPhase({ name: 'chat', self })
        }}
      />
    )
  }

  return (
    <ChatScreen
      service={chatService}
      self={phase.self}
      onLeave={() => {
        chatService.leave()
        clearNickname()
        setPhase({ name: 'join' })
      }}
    />
  )
}

import type { Language } from "@kotori/domain"
import { type AudioPlayer, createAudioPlayer } from "expo-audio"
import { useEffect, useState } from "react"
import { apiAsset } from "../api/config.ts"
import { useSpeak } from "../api/queries.ts"
import { useT } from "../session/SessionProvider.tsx"
import { IconButton } from "./Button.tsx"

let current: AudioPlayer | null = null
let stopCurrent: (() => void) | null = null

/** Plays one clip at a time; starting another stops the first. */
const play = (url: string, onEnd: () => void) => {
  stopCurrent?.()
  current?.remove()
  const player = createAudioPlayer({ uri: apiAsset(url) })
  current = player
  stopCurrent = onEnd
  const subscription = player.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) {
      subscription.remove()
      onEnd()
    }
  })
  player.play()
}

/** Plays a stored clip, or asks the server to voice `speak` on demand. */
export const AudioButton = (
  { url, speak, size = 40 }: {
    readonly url?: string | null
    readonly speak?: { readonly text: string; readonly language: Language }
    readonly size?: number
  }
) => {
  const t = useT()
  const [playing, setPlaying] = useState(false)
  const [resolved, setResolved] = useState<string | null>(url ?? null)
  const synth = useSpeak()

  useEffect(() => setResolved(url ?? null), [url])

  if (!resolved && !speak) return null

  const onPress = async () => {
    let target = resolved
    if (target === null && speak) {
      try {
        target = (await synth.mutateAsync(speak)).url
        setResolved(target)
      } catch {
        return
      }
    }
    if (target === null) return
    setPlaying(true)
    play(target, () => setPlaying(false))
  }

  return (
    <IconButton
      icon={synth.isPending ? "ellipsis-horizontal" : playing ? "volume-high" : "volume-medium-outline"}
      label={t.common.listen}
      tone="primary"
      active={playing}
      size={size}
      onPress={onPress}
    />
  )
}

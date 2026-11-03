import type { Language } from "@kotori/contracts"
import { type AudioPlayer, createAudioPlayer } from "expo-audio"
import { useEffect, useState } from "react"
import { Platform } from "react-native"
import { apiAsset } from "../api/config.ts"
import { useSpeak } from "../api/queries.ts"
import { useT } from "../session/SessionProvider.tsx"
import { Button, IconButton } from "./Button.tsx"

let current: AudioPlayer | null = null
let stopCurrent: (() => void) | null = null
let stopPrimed: (() => void) | null = null

/**
 * A silent wav, played inside the tap. iOS Safari only allows a clip to start
 * from a user gesture; speech that has to be generated first returns after an
 * await, so the real clip has to continue on an element this tap already started.
 */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="

const primeWebPlayback = (): HTMLAudioElement | null => {
  if (Platform.OS !== "web" || typeof Audio === "undefined") return null
  const audio = new Audio(SILENT_WAV)
  void audio.play().catch(() => {})
  return audio
}

/** Plays one clip at a time; starting another stops the first. */
const play = (url: string, onEnd: () => void, primed?: HTMLAudioElement | null) => {
  stopCurrent?.()
  current?.remove()
  current = null
  stopPrimed?.()
  stopPrimed = null
  const absolute = apiAsset(url)
  if (primed) {
    primed.src = absolute
    const finish = () => {
      primed.removeEventListener("ended", finish)
      onEnd()
    }
    primed.addEventListener("ended", finish)
    stopPrimed = () => {
      primed.removeEventListener("ended", finish)
      primed.pause()
    }
    stopCurrent = onEnd
    void primed.play().catch(() => onEnd())
    return
  }
  const player = createAudioPlayer({ uri: absolute })
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

/** Plays a stored clip, or asks the server to voice `speak` on demand. With a `label`, it's a pill. */
export const AudioButton = ({
  url,
  speak,
  size = 44,
  label
}: {
  readonly url?: string | null
  readonly speak?: { readonly text: string; readonly language: Language }
  readonly size?: number
  readonly label?: string
}) => {
  const t = useT()
  const [playing, setPlaying] = useState(false)
  const [resolved, setResolved] = useState<string | null>(url ?? null)
  const synth = useSpeak()

  useEffect(() => setResolved(url ?? null), [url])

  if (!resolved && !speak) return null

  const onPress = async () => {
    let target = resolved
    // Before the first await, so iOS still counts this as the tap that started playback.
    const primed = target === null && speak ? primeWebPlayback() : null
    if (target === null && speak) {
      try {
        target = (await synth.mutateAsync(speak)).url
        setResolved(target)
      } catch {
        primed?.pause()
        return
      }
    }
    if (target === null) {
      primed?.pause()
      return
    }
    setPlaying(true)
    play(target, () => setPlaying(false), primed)
  }

  if (label) {
    return <Button label={label} icon="play_arrow" loading={synth.isPending} onPress={onPress} />
  }

  return (
    <IconButton
      icon={synth.isPending ? "more_horiz" : "volume_up"}
      label={t.common.listen}
      tone="surface"
      active={playing}
      size={size}
      onPress={onPress}
    />
  )
}

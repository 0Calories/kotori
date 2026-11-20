import { useCallback, useState } from "react"
import { type LayoutChangeEvent, View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { baseline, type Face } from "../theme/tokens.ts"

// Cubic-bezier approximation of CSS `underline wavy 1.5px` at 6px offset (2.2px amplitude, 9.5px below baseline).
const WAVELENGTH = 11
const CONTROL = 7.5
const STROKE = 2
const HEIGHT = 8
const DROP = 9.5

const wave = (width: number) => {
  let path = `M0 ${HEIGHT / 2}`
  for (let x = 0; x < width; x += WAVELENGTH) {
    path += `c${WAVELENGTH / 2} ${CONTROL} ${WAVELENGTH / 2} ${-CONTROL} ${WAVELENGTH} 0`
  }
  return path
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Piece {
  readonly box: Box
  readonly mark: number
  readonly space: boolean
}

interface Run {
  readonly x: number
  readonly width: number
  readonly bottom: number
}

const runs = (pieces: ReadonlyArray<Piece>, lineHeight: number): Array<Run> => {
  const lines = new Map<string, Array<{ readonly x: number; readonly right: number; readonly space: boolean }>>()
  for (const { box, mark, space } of pieces) {
    // Split pieces taller than one line so a wrapped overlong word gets a squiggle on each line.
    const count = Math.max(1, Math.round(box.height / lineHeight))
    for (let line = 0; line < count; line++) {
      const bottom = Math.round(box.y + box.height - (count - 1 - line) * lineHeight)
      const key = `${mark}:${bottom}`
      lines.set(key, [...(lines.get(key) ?? []), { x: box.x, right: box.x + box.width, space }])
    }
  }
  return [...lines.entries()].flatMap(([key, line]) => {
    const words = line.filter((piece) => !piece.space)
    if (words.length === 0) return []
    const x = Math.min(...words.map((piece) => piece.x))
    const right = Math.max(...words.map((piece) => piece.right))
    return [{ x, width: right - x, bottom: Number(key.split(":")[1]) }]
  })
}

export const Squiggles = ({
  pieces,
  face,
  size,
  lineHeight,
  color
}: {
  readonly pieces: ReadonlyArray<Piece>
  readonly face: Face
  readonly size: number
  readonly lineHeight: number
  readonly color: string
}) => {
  const axis = baseline(face, size, lineHeight) + DROP - lineHeight
  return (
    <>
      {runs(pieces, lineHeight).map((run) => (
        <View
          key={`${run.x}:${run.bottom}`}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: run.x,
            top: run.bottom + axis - HEIGHT / 2,
            width: run.width,
            height: HEIGHT,
            overflow: "hidden"
          }}
        >
          <Svg width={run.width} height={HEIGHT}>
            <Path d={wave(run.width)} stroke={color} strokeWidth={STROKE} fill="none" />
          </Svg>
        </View>
      ))}
    </>
  )
}

export const useBoxes = () => {
  const [boxes, setBoxes] = useState<ReadonlyMap<string, Box>>(new Map())
  const measure = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      const { x, y, width, height } = event.nativeEvent.layout
      setBoxes((old) => {
        const before = old.get(key)
        if (before && before.x === x && before.y === y && before.width === width && before.height === height) {
          return old
        }
        return new Map(old).set(key, { x, y, width, height })
      })
    },
    []
  )
  return [boxes, measure] as const
}

export interface Range {
  readonly start: number
  readonly end: number
}

export const mistakeRanges = (text: string, excerpts: ReadonlyArray<string>): Array<Range> => {
  const found: Array<Range> = []
  for (const excerpt of excerpts) {
    if (excerpt.length === 0) continue
    const first = text.indexOf(excerpt)
    let at = first
    while (at >= 0 && found.some((range) => at < range.end && at + excerpt.length > range.start)) {
      at = text.indexOf(excerpt, at + 1)
    }
    const start = at >= 0 ? at : first
    if (start >= 0) found.push({ start, end: start + excerpt.length })
  }
  return found
    .sort((a, b) => a.start - b.start)
    .reduce<Array<Range>>((merged, range) => {
      const last = merged[merged.length - 1]
      if (last && range.start <= last.end) {
        merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
      } else {
        merged.push(range)
      }
      return merged
    }, [])
}

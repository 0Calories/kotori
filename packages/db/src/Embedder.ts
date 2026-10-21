import { Effect } from "effect"

/** multilingual-e5-small, the size sqlite-vec is created with. */
export const EMBED_DIM = 384

const MODEL = "Xenova/multilingual-e5-small"

type Extractor = (
  texts: string | string[],
  options: { readonly pooling: "mean"; readonly normalize: true }
) => Promise<{ readonly data: ArrayLike<number>; readonly dims: readonly number[] }>

let model: Promise<Extractor> | null = null

const extractor = () => {
  model ??= import("@huggingface/transformers").then((mod) =>
    mod.pipeline("feature-extraction", MODEL, { dtype: "q8" }) as Promise<Extractor>
  )
  return model
}

const vectors = async (texts: readonly string[]) => {
  const run = await extractor()
  const out: Float32Array[] = []
  const batch = 32
  for (let start = 0; start < texts.length; start += batch) {
    const slice = texts.slice(start, start + batch)
    const output = await run(slice.length === 1 ? slice[0]! : [...slice], { pooling: "mean", normalize: true })
    const dim = output.dims[output.dims.length - 1] ?? EMBED_DIM
    if (dim !== EMBED_DIM) throw new Error(`expected ${EMBED_DIM}-d embeddings, got ${dim}`)
    const flat = Float32Array.from(output.data)
    for (let i = 0; i < slice.length; i++) out.push(flat.slice(i * dim, (i + 1) * dim))
  }
  return out
}

/** e5 wants a `query:` prefix on searches and `passage:` on indexed text. */
export const embedQuery = (text: string) =>
  Effect.tryPromise({
    try: () => vectors([`query: ${text}`]).then((rows) => rows[0]!),
    catch: (cause) => cause
  })

export const embedPassages = (texts: readonly string[]) =>
  Effect.tryPromise({
    try: () => vectors(texts.map((text) => `passage: ${text}`)),
    catch: (cause) => cause
  })

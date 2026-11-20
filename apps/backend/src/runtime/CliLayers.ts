import { NodeHttpClient } from "@effect/platform-node"
import { AiProviders, CautionWriter, Claude, FrequencyRater, Jev, Lexicographer, Pronouncer } from "@kotori/ai"
import { Layer } from "effect"
import { DatabaseLive } from "../db/Database.ts"
import { Approvals } from "../features/accounts/Approvals.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import { MailerLive } from "../integrations/email/live.ts"

export const SeedLive = Layer.mergeAll(DatabaseLive, NodeHttpClient.layerUndici)

export const AccountsLive = Approvals.layer.pipe(
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(MailerLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(NodeHttpClient.layerUndici)
)

export const FrequencyLive = FrequencyRater.layer.pipe(
  Layer.provideMerge(Claude.layer),
  Layer.provideMerge(DatabaseLive)
)

export const JudgeLive = CautionWriter.layer.pipe(
  Layer.provideMerge(Claude.layer),
  Layer.provideMerge(Jev.layer),
  Layer.provideMerge(DatabaseLive)
)

export const EvalLive = Layer.mergeAll(CautionWriter.layer, Lexicographer.layer).pipe(
  Layer.provideMerge(Claude.layer),
  Layer.provideMerge(Jev.layer)
)

export const RedoLive = Layer.mergeAll(Dictionary.layer, Lexicographer.layer).pipe(
  Layer.provideMerge(Pronouncer.layer),
  Layer.provideMerge(AiProviders),
  Layer.provideMerge(NodeHttpClient.layerUndici)
)

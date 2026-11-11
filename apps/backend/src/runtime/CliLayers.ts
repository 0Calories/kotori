import { NodeHttpClient } from "@effect/platform-node"
import { AiProviders, Claude, FrequencyRater, Lexicographer, Pronouncer } from "@kotori/ai"
import { Layer } from "effect"
import { DatabaseLive } from "../db/Database.ts"
import { Approvals } from "../features/accounts/Approvals.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import { MailerLive } from "../integrations/email/live.ts"

/** What `kotori seed` needs: the database, and an HTTP client to download the sources. */
export const SeedLive = Layer.mergeAll(DatabaseLive, NodeHttpClient.layerUndici)

/** What the account commands need: approvals and the identity they act on, the learner table and mail. */
export const AccountsLive = Approvals.layer.pipe(
  // Sign-up approval shares the auth database with the API, through Better Auth.
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(MailerLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(NodeHttpClient.layerUndici)
)

/** What `kotori frequency` needs: Claude to rate phrases, and the database for the phrases to rate. */
export const FrequencyLive = FrequencyRater.layer.pipe(
  Layer.provideMerge(Claude.layer),
  Layer.provideMerge(DatabaseLive)
)

/**
 * What `kotori proposals redo` adds to the database the other `proposals` commands need: the
 * dictionary and Claude to judge the query again. The database comes from the parent command.
 */
export const RedoLive = Layer.mergeAll(Dictionary.layer, Lexicographer.layer).pipe(
  Layer.provideMerge(Pronouncer.layer),
  Layer.provideMerge(AiProviders),
  Layer.provideMerge(NodeHttpClient.layerUndici)
)

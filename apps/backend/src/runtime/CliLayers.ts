import { NodeHttpClient } from "@effect/platform-node"
import { Claude, FamiliarityRater } from "@kotori/ai"
import { Layer } from "effect"
import { DatabaseLive } from "../db/Database.ts"
import { Approvals } from "../features/accounts/Approvals.ts"
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

/** What `kotori familiarity` needs: Claude to rate phrases, and the database for the phrases to rate. */
export const FamiliarityLive = FamiliarityRater.layer.pipe(
  Layer.provideMerge(Claude.layer),
  Layer.provideMerge(DatabaseLive)
)

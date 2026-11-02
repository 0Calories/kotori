import { NodeHttpClient } from "@effect/platform-node"
import { Approvals } from "../features/accounts/Approvals.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import { DatabaseLive, Repositories } from "@kotori/db"
import { MailerLive } from "../integrations/email/live.ts"
import { Layer } from "effect"

/** What `kotori seed` needs: the repositories, and an HTTP client to download the sources. */
export const SeedLive = Repositories.pipe(
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(NodeHttpClient.layerUndici)
)

/** What the account commands need: approvals and the identity they act on, the learner table and mail. */
export const AccountsLive = Approvals.layer.pipe(
  // Sign-up approval shares the auth database with the API, through Better Auth.
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(MailerLive),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(NodeHttpClient.layerUndici)
)

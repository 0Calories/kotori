import { defineConfig } from "@neon/config/v1"

/**
 * Neon branch config (infrastructure-as-code): every branch gets Lakebase
 * Postgres plus the services declared here, reconciled with `neon deploy`
 * (see docs/deploy.md). `neon checkout <name> --create` applies the branch
 * policy below when it creates a branch.
 */
export default defineConfig({
  // Managed Better Auth: users and sessions in this branch's `neon_auth`
  // schema; the branch's Auth URL lands in env as NEON_AUTH_BASE_URL.
  auth: true,
  branch: (branch) => {
    // Leave existing branches (and production) untouched.
    if (branch.exists || branch.isDefault) return {}
    // Dev branches clean themselves up and stay small. (The suspend interval is
    // left at the project default: changing it is not permitted on every plan.)
    return {
      ttl: "14d",
      postgres: {
        computeSettings: {
          autoscalingLimitMinCu: 0.25,
          autoscalingLimitMaxCu: 1
        }
      }
    }
  }
})

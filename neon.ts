import { defineConfig } from "@neon/config/v1"

export default defineConfig({
  auth: true,
  branch: (branch) => {
    if (branch.exists || branch.isDefault) return {}
    // Neon's suspend interval is omitted because changing it is rejected on non-scale plans.
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

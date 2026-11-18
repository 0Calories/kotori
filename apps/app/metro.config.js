const { getSentryExpoConfig } = require("@sentry/react-native/metro")

const config = getSentryExpoConfig(__dirname, {
  autoWrapExpoRouterErrorBoundary: true
})

// Resolve `@kotori/*` workspace packages from TypeScript source via their `exports` map.
config.resolver.unstable_conditionNames = [...(config.resolver.unstable_conditionNames ?? []), "@kotori/source"]

module.exports = config

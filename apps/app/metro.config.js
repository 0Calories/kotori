// Expo's Metro config detects the pnpm workspace and watches the shared packages. Sentry's wrapper
// adds debug IDs to bundles and source maps, so production stack traces can be resolved.
const { getSentryExpoConfig } = require("@sentry/react-native/metro")

const config = getSentryExpoConfig(__dirname, {
  // Report errors caught by Expo Router's per-route ErrorBoundary exports.
  autoWrapExpoRouterErrorBoundary: true
})

// Resolve `@kotori/*` packages from their TypeScript source (see the `exports` map in each package).
config.resolver.unstable_conditionNames = [...(config.resolver.unstable_conditionNames ?? []), "@kotori/source"]

module.exports = config

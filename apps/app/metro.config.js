// Expo's Metro config detects the pnpm workspace and watches the shared packages.
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)

// Resolve `@kotori/*` packages from their TypeScript source (see the `exports` map in each package).
config.resolver.unstable_conditionNames = [...(config.resolver.unstable_conditionNames ?? []), "@kotori/source"]

module.exports = config

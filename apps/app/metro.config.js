// Expo's Metro config detects the pnpm workspace and watches the shared packages.
const { getDefaultConfig } = require("expo/metro-config")

module.exports = getDefaultConfig(__dirname)

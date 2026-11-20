/* oxlint-disable import/no-unassigned-import -- each is loaded for its side effects */
// Import order matters on web: metro-runtime enables Fast Refresh, and googleCapture must strip OAuth params from window.location before Expo Router or Sentry reads it.
import "@expo/metro-runtime"
import "./src/auth/googleCapture"
import "expo-router/entry"

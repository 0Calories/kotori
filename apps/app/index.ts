// The app's entry point. On the web, Google's answer comes off the address bar before Expo Router
// copies the URL into its navigation state and before `app/_layout.tsx` starts Sentry; see
// `src/auth/googleCapture.web.ts`. Imports run in this order.
/* oxlint-disable import/no-unassigned-import -- each is loaded for its side effects */
// Expo asks for this first, so Fast Refresh works on the web.
import "@expo/metro-runtime"
import "./src/auth/googleCapture"
import "expo-router/entry"

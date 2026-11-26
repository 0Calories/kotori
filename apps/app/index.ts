// The app's entry point. On the web, Google's answer comes off the address bar before Expo Router
// copies the URL into its navigation state and before `app/_layout.tsx` starts Sentry; see
// `src/auth/googleCapture.web.ts`. The stale-build listener is in place before Expo Router requests
// the first route's chunk; see `src/lib/staleBuildReload.ts`. Imports run in this order.
/* oxlint-disable import/no-unassigned-import -- each is loaded for its side effects */
// Expo asks for this first, so Fast Refresh works on the web.
import "@expo/metro-runtime"
import "./src/auth/googleCapture"
import "./src/lib/staleBuildReload"
import "expo-router/entry"

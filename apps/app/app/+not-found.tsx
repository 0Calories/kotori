import { Stack, useRouter } from "expo-router"
import { Button } from "../src/components/Button.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { MascotMessage } from "../src/components/States.tsx"
import { formatDocumentTitle } from "../src/lib/webChrome.ts"
import { homeHrefFor, useSession } from "../src/session/SessionProvider.tsx"

/** Branded 404 screen so unmatched URLs never expose Expo Router's developer sitemap. */
export default function NotFoundScreen() {
  const router = useRouter()
  const { status, t } = useSession()

  return (
    <Screen bottomInset={40}>
      <Stack.Screen options={{ title: formatDocumentTitle(t.notFound.title, t.appName) }} />
      <MascotMessage mood="oops" title={t.notFound.title} body={t.notFound.body} size={140}>
        <Button label={t.notFound.home} icon="arrow_back" onPress={() => router.replace(homeHrefFor(status))} />
      </MascotMessage>
    </Screen>
  )
}

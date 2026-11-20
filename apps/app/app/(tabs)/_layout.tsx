import { Tabs } from "expo-router"
import { useDueNotes } from "../../src/api/queries.ts"
import { TabBar } from "../../src/components/TabBar.tsx"
import { formatDocumentTitle } from "../../src/lib/webChrome.ts"
import { useT } from "../../src/session/SessionProvider.tsx"

export default function TabsLayout() {
  const t = useT()
  const dueNotes = useDueNotes()
  const due = dueNotes.data ? dueNotes.data.counts.new + dueNotes.data.counts.learning + dueNotes.data.counts.review : 0
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} badges={{ review: due }} />}>
      <Tabs.Screen name="index" options={{ title: t.appName }} />
      <Tabs.Screen name="say" options={{ title: formatDocumentTitle(t.tabs.say, t.appName) }} />
      <Tabs.Screen name="check" options={{ title: formatDocumentTitle(t.tabs.check, t.appName) }} />
      <Tabs.Screen name="review" options={{ title: formatDocumentTitle(t.tabs.review, t.appName) }} />
    </Tabs>
  )
}

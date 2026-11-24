import { Tabs } from "expo-router"
import { TabBar } from "../../src/components/TabBar.tsx"
import { formatDocumentTitle } from "../../src/lib/webChrome.ts"
import { useT } from "../../src/session/SessionProvider.tsx"

export default function TabsLayout() {
  const t = useT()
  const titled = (part: string) => formatDocumentTitle(part, t.appName)
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: t.appName }} />
      <Tabs.Screen name="say" options={{ title: titled(t.tabs.say) }} />
      <Tabs.Screen name="check" options={{ title: titled(t.tabs.check) }} />
      <Tabs.Screen name="notebook" options={{ title: titled(t.tabs.notebook) }} />
    </Tabs>
  )
}

import { Tabs } from "expo-router"
import { useQueue } from "../../src/api/queries.ts"
import { TabBar } from "../../src/components/TabBar.tsx"

export default function TabsLayout() {
  const queue = useQueue()
  const due = queue.data ? queue.data.counts.new + queue.data.counts.learning + queue.data.counts.review : 0
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} badges={{ review: due }} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="check" />
      <Tabs.Screen name="say" />
      <Tabs.Screen name="review" />
    </Tabs>
  )
}

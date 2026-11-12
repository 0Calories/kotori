import { Tabs } from "expo-router"
import { useDueNotes } from "../../src/api/queries.ts"
import { TabBar } from "../../src/components/TabBar.tsx"

export default function TabsLayout() {
  const dueNotes = useDueNotes()
  const due = dueNotes.data ? dueNotes.data.counts.new + dueNotes.data.counts.learning + dueNotes.data.counts.review : 0
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} badges={{ review: due }} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="say" />
      <Tabs.Screen name="check" />
      <Tabs.Screen name="review" />
    </Tabs>
  )
}

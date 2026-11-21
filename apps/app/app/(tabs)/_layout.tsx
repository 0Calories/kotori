import { Tabs } from "expo-router"
import { TabBar } from "../../src/components/TabBar.tsx"

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="say" />
      <Tabs.Screen name="check" />
      <Tabs.Screen name="notebook" />
    </Tabs>
  )
}

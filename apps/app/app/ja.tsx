import { Redirect } from "expo-router"
import { homeHrefFor, useSession } from "../src/session/SessionProvider.tsx"

export default function JapaneseEntry() {
  const { status } = useSession()
  if (status === "loading") return null
  return <Redirect href={homeHrefFor(status)} />
}

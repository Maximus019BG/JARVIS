import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { colors } from "~/theme"

export default function Layout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "JARVIS" }} />
        <Stack.Screen name="sessions" options={{ title: "Sessions" }} />
        <Stack.Screen name="talk" options={{ title: "Talk" }} />
        <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
      </Stack>
    </>
  )
}

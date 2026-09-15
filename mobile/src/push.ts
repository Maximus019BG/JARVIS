import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"
import { registerPush } from "./api"

/**
 * Registers this handset for the push notifications the web app already sends when a terminal
 * blocks on an approval.
 *
 * `PUT /api/mobile/notifications` has existed on the server the whole time with nothing to
 * call it. This is that call.
 */
export async function registerForPush(): Promise<string | undefined> {
  // A simulator has no push token, and asking for one there fails in a way that reads like a
  // bug rather than like the emulator it is.
  if (!Constants.isDevice) return undefined

  if (Platform.OS === "android") {
    // Android will not show a notification without a channel, and silently drops it instead.
    await Notifications.setNotificationChannelAsync("approvals", {
      name: "Approvals",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  const granted = existing.granted ? existing : await Notifications.requestPermissionsAsync()
  if (!granted.granted) return undefined

  // The project id comes from the EAS config; without it Expo cannot mint a token, and the
  // error it raises does not say which of the two files is missing it.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data

  await registerPush(token)
  return token
}

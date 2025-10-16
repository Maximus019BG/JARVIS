import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

// Configure how notifications are handled when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,   // iOS sound
    shouldSetBadge: true,    // badge count on app icon
    shouldShowBanner: true,  // iOS banner
    shouldShowList: true,
  }),
});

/**
 * Register for push notifications and get Expo push token.
 * Logs everything for testing in https://expo.dev/notifications
 */
export async function registerForPushNotificationsAsync() {
    if (Platform.OS === "android" && !Constants.isDevice) {
        console.warn("⚠️ Running on Expo Go: Push notifications won’t work on Android");
    }

    // Get existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync({
            ios: {
                allowAlert: true,
                allowBadge: true,
                allowSound: true,
                allowCriticalAlerts: true, // optional, for critical notifications
            },
        });
        finalStatus = status;
    }
    if (finalStatus !== "granted") {
        console.warn("Push notification permission not granted");
        return null;
    }

    // Get Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync();
    console.log("✅ Expo push token:", tokenData.data);
    console.log("Full token object:", tokenData);

    // Optional: log platform info
    console.log("Device platform:", Platform.OS);

    return tokenData.data;
}

/**
 * Add listeners for notifications and responses.
 * Returns a cleanup function to remove the listeners.
 */
export function addNotificationListeners(onReceived?: (notification: Notifications.Notification) => void, onResponse?: (response: Notifications.NotificationResponse) => void) {
    const receivedListener = Notifications.addNotificationReceivedListener((notification) => {
        console.log("🔔 Notification received:");
        console.log(JSON.stringify(notification, null, 2));
        if (onReceived) onReceived(notification);
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("📩 Notification response:");
        console.log(JSON.stringify(response, null, 2));
        if (onResponse) onResponse(response);
    });

    return () => {
        receivedListener.remove();
        responseListener.remove();
    };
}


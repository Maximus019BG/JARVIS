import axios from "axios";

export async function sendPushNotification(
  expoPushToken: string | null,
  title: string,
  body: string,
): Promise<void> {
  // Was `typeof(expoPushToken) === null`, which compares a string to null and is always
  // false — so a null token used to reach Expo.
  if (!expoPushToken) {
    throw new Error("no token found");
  }
  const reqBody = {
    to: expoPushToken,
    title,
    body: `${body}`,
    sound: "default",
  };
  try {
    // Send notification
    await axios
      .post("https://exp.host/--/api/v2/push/send", reqBody, {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
      })
      .catch((error) => {
        // Throw error
        throw error;
      });
  } catch (error) {
    console.error("Error sending push notification:", error);
    throw error;
  }
}

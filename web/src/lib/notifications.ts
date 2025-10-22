import axios from "axios";

export async function sendPushNotification(
  expoPushToken: string | null,
  title: string,
  body: string,
): Promise<void> {
  // Build the request body
  if(typeof(expoPushToken) === null){
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
      .then((response) => {
        console.log(response);
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

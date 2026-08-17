import { db } from "~/server/db";
import { session } from "~/server/db/schemas/session";
import { and, eq, gt, isNotNull } from "drizzle-orm";

/**
 * Every live mobile push token a user has. The column lives on `session`, not `user`, so
 * somebody logged in on two phones gets two notifications and somebody whose mobile
 * session expired gets none — they answer in the web app instead.
 */
export async function getExpoPushTokensByUserId(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: session.mobileExpoPushToken })
    .from(session)
    .where(
      and(
        eq(session.userId, userId),
        isNotNull(session.mobileExpoPushToken),
        gt(session.expiresAt, new Date()),
      ),
    );
  // De-duplicated: the same device re-authenticating leaves several sessions carrying one
  // token, and Expo would deliver the notification once per row.
  return [...new Set(rows.map((row) => row.token).filter((token): token is string => !!token))];
}

export async function updateSessionWithExpoPushToken(
  sessionId: string, 
  mobileExpoPushToken: string
) {
  try {
    const updatedSession = await db
      .update(session)
      .set({ 
        mobileExpoPushToken,
        updatedAt: new Date()
      })
      .where(eq(session.id, sessionId))
      .returning();
    return updatedSession[0];
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error updating session with Expo push token:", error.message);
      throw error;
    } else {
      console.error("Error updating session with Expo push token:", error);
      throw new Error("Unknown error occurred while updating session with Expo push token.");
    }
  }
}

//Get expo push token by session id
export async function getExpoPushTokenBySessionId(sessionId: string) {
    try {
        const [sess] = await db
            .select()
            .from(session)
            .where(eq(session.id, sessionId))
            .limit(1);
        return sess?.mobileExpoPushToken ?? null;
    }
    catch (error) {
        if (error instanceof Error) {
            console.error("Error fetching Expo push token by session ID:", error.message);
            throw error;
        } else {
            console.error("Error fetching Expo push token by session ID:", error);
            throw new Error("Unknown error occurred while fetching Expo push token by session ID.");
        }
    }
}
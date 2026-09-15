import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native"
import { ApiError, idle, listApprovals, listSessions, signOut, type Session } from "~/api"
import { registerForPush } from "~/push"
import { colors, styles } from "~/theme"

/** Which terminal to talk to. */
export default function Sessions() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [waiting, setWaiting] = useState(0)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [rows, approvals] = await Promise.all([listSessions(), listApprovals().catch(() => [])])
      setSessions(rows)
      setWaiting(approvals.length)
      setError("")
    } catch (problem) {
      // A 401 means the token expired or was revoked from the web app's Devices tab. Signing
      // out locally is the honest response — the alternative is a list that never loads and
      // never says why.
      if (problem instanceof ApiError && problem.status === 401) {
        await signOut()
        router.replace("/")
        return
      }
      setError(problem instanceof ApiError ? problem.message : String(problem))
    } finally {
      setLoading(false)
    }
  }, [router])

  useFocusEffect(
    useCallback(() => {
      void refresh()
      // Registered from here rather than at launch: the token is only useful once there is a
      // signed-in session to attach it to, and this is the first screen behind one.
      void registerForPush().catch(() => {
        // A phone without notification permission is still a perfectly good microphone.
      })
    }, [refresh]),
  )

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {waiting > 0 && (
        <Pressable
          style={[styles.card, { borderColor: colors.warn }]}
          onPress={() => router.push("/approvals")}
        >
          <Text style={[styles.cardTitle, { color: colors.warn }]}>
            {waiting} approval{waiting === 1 ? "" : "s"} waiting
          </Text>
          <Text style={styles.cardMeta}>A terminal has stopped and needs an answer.</Text>
        </Pressable>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(session) => session.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.muted} />
        }
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.sub}>
              No sessions yet. A terminal appears here once it has mirrored one — turn on
              `syncSessions` in its config.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, !item.fresh && { opacity: 0.55 }]}
            onPress={() => router.push({ pathname: "/talk", params: { id: item.id, title: item.title } })}
          >
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.mono} numberOfLines={1}>
              {item.cwd}
            </Text>
            <Text style={styles.cardMeta}>
              {item.workstation ?? "unknown workstation"} · {idle(item.idleMs)}
              {item.queued > 0 ? ` · ${item.queued} queued` : ""}
              {item.full ? " · queue full" : ""}
            </Text>
          </Pressable>
        )}
      />

      <Pressable
        style={styles.ghost}
        onPress={() =>
          void signOut().then(() => {
            router.replace("/")
          })
        }
      >
        <Text style={styles.ghostText}>Sign out</Text>
      </Pressable>
    </View>
  )
}

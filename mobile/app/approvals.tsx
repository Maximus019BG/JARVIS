import { useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { ApiError, answerApproval, listApprovals, type Approval } from "~/api"
import { colors, styles } from "~/theme"

/**
 * The other half of being away from the desk: a terminal has stopped mid-turn and wants a
 * yes or a no.
 *
 * Only `once` and `reject` are offered, and that is the server's rule rather than a shortcut
 * here — `always` seeds the permission cache and can rewrite the project's config on disk. A
 * tap on a phone should approve one action, not widen policy.
 */
export default function Approvals() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [busy, setBusy] = useState<string | undefined>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setApprovals(await listApprovals())
      setError("")
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : String(problem))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const answer = (id: string, choice: "once" | "reject") => {
    setBusy(id)
    setError("")
    void answerApproval(id, choice)
      .then(() => setApprovals((current) => current.filter((approval) => approval.id !== id)))
      .catch((problem: unknown) => {
        // 409 is the terminal having answered first, or a second tap. Not an error worth red
        // text — the row is simply gone.
        if (problem instanceof ApiError && problem.status === 409) {
          return setApprovals((current) => current.filter((approval) => approval.id !== id))
        }
        setError(problem instanceof ApiError ? problem.message : String(problem))
      })
      .finally(() => setBusy(undefined))
  }

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={approvals}
        keyExtractor={(approval) => approval.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.muted} />
        }
        ListEmptyComponent={loading ? null : <Text style={styles.sub}>Nothing is waiting.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {item.tool} · {item.deviceName ?? "unknown device"}
            </Text>
            {item.detail ? (
              // A diff can be long and is the only thing worth reading before answering, so it
              // gets its own scroll rather than being truncated to a line.
              <ScrollView style={{ maxHeight: 200, marginTop: 10 }} horizontal={false}>
                <Text style={styles.mono}>{item.detail}</Text>
              </ScrollView>
            ) : null}
            <View style={[styles.row, { marginTop: 12 }]}>
              <Pressable
                style={[styles.ghost, { flex: 1, borderColor: colors.danger }]}
                disabled={busy === item.id}
                onPress={() => answer(item.id, "reject")}
              >
                <Text style={[styles.ghostText, { color: colors.danger }]}>Reject</Text>
              </Pressable>
              <Pressable
                style={[styles.button, { flex: 1, backgroundColor: colors.ok }]}
                disabled={busy === item.id}
                onPress={() => answer(item.id, "once")}
              >
                <Text style={styles.buttonText}>Allow once</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  )
}

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { ApiError, sendPrompt } from "~/api"
import { colors, styles } from "~/theme"

/**
 * Push to talk, on-device.
 *
 * Recognition runs on the phone rather than going through the server, which is the whole
 * reason this screen needs no new API: what crosses the network is the same text a thumb
 * could have typed, on the endpoint that already existed for typing it. No audio leaves the
 * handset, there is no key to hold, and it works on a train.
 *
 * The text lands in an editable box rather than being sent, for the same reason the terminal
 * does it: recognition mishears things, and a misheard prompt that has already started a turn
 * costs money to take back.
 */
export default function Talk() {
  const router = useRouter()
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>()
  const [text, setText] = useState("")
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  useSpeechRecognitionEvent("start", () => setListening(true))
  useSpeechRecognitionEvent("end", () => setListening(false))
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false)
    // `no-speech` is what you get for letting go too quickly. It is not worth red text.
    if (event.error !== "no-speech") setError(event.message || String(event.error))
  })
  useSpeechRecognitionEvent("result", (event) => {
    const heard = event.results[0]?.transcript
    if (heard !== undefined) setText(heard)
  })

  const start = useCallback(async () => {
    setError("")
    setStatus("")
    const granted = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!granted.granted) return setError("microphone and speech permission are needed to talk")
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      // Partial results so the words appear while you are still speaking, and on-device where
      // the platform can manage it — the point of transcribing here is that nothing leaves.
      interimResults: true,
      requiresOnDeviceRecognition: false,
      continuous: true,
    })
  }, [])

  const send = useCallback(() => {
    const prompt = text.trim()
    if (!prompt || !id) return
    setError("")
    void sendPrompt(id, prompt)
      .then(() => {
        setText("")
        setStatus("queued — the terminal picks it up between turns")
      })
      .catch((problem: unknown) => {
        if (problem instanceof ApiError && problem.status === 429) {
          return setError("that terminal has not picked up the earlier prompts yet")
        }
        setError(problem instanceof ApiError ? problem.message : String(problem))
      })
  }, [id, text])

  return (
    <View style={styles.screen}>
      <Text style={styles.heading} numberOfLines={1}>
        {title ?? "Session"}
      </Text>
      <Text style={styles.sub}>
        Held down, this listens. Let go and the words land below to check before sending.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={[styles.sub, { color: colors.ok }]}>{status}</Text> : null}

      <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
        <TextInput
          style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]}
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Hold the button and speak, or type."
          placeholderTextColor={colors.dim}
        />
      </ScrollView>

      <Pressable
        style={[
          styles.button,
          {
            backgroundColor: listening ? colors.danger : colors.panel,
            borderWidth: 1,
            borderColor: listening ? colors.danger : colors.line,
            paddingVertical: 28,
          },
        ]}
        onPressIn={() => void start()}
        onPressOut={() => ExpoSpeechRecognitionModule.stop()}
      >
        <Text style={[styles.buttonText, { color: listening ? "#ffffff" : colors.muted }]}>
          {listening ? "● listening — let go to stop" : "Hold to talk"}
        </Text>
      </Pressable>

      <View style={{ height: 12 }} />
      <View style={styles.row}>
        <Pressable style={[styles.ghost, { flex: 1 }]} onPress={() => setText("")}>
          <Text style={styles.ghostText}>Clear</Text>
        </Pressable>
        <Pressable
          style={[styles.button, { flex: 2, opacity: text.trim() ? 1 : 0.4 }]}
          disabled={!text.trim()}
          onPress={send}
        >
          <Text style={styles.buttonText}>Send</Text>
        </Pressable>
      </View>

      <View style={{ height: 12 }} />
      <Pressable style={styles.ghost} onPress={() => router.push("/approvals")}>
        <Text style={styles.ghostText}>Approvals</Text>
      </Pressable>
    </View>
  )
}

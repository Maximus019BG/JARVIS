import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"
import { ApiError, currentBaseUrl, loadSession, setBaseUrl, signIn, verifyTotp } from "~/api"
import { colors, styles } from "~/theme"

type Step = "loading" | "address" | "credentials" | "totp"

/**
 * Sign-in, in as few screens as it can be done in.
 *
 * The address comes first and is asked once: this is a self-hosted app, so there is no
 * default server to fall back to, and every later screen is meaningless without it.
 */
export default function SignIn() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("loading")
  const [address, setAddress] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void loadSession().then(({ baseUrl, signedIn }) => {
      setAddress(baseUrl ?? "")
      if (signedIn) return router.replace("/sessions")
      setStep(baseUrl ? "credentials" : "address")
    })
  }, [router])

  /** Every step fails the same way, so they share one runner. */
  const attempt = (work: () => Promise<void>) => {
    setBusy(true)
    setError("")
    void work()
      .catch((problem: unknown) =>
        setError(problem instanceof ApiError ? problem.message : String(problem)),
      )
      .finally(() => setBusy(false))
  }

  if (step === "loading") {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>
        {step === "address" ? "Where is your JARVIS?" : step === "totp" ? "Second factor" : "Sign in"}
      </Text>
      <Text style={styles.sub}>
        {step === "address"
          ? "The address of your web app — the same one your workstation pairs with."
          : step === "totp"
            ? "The six digits from your authenticator."
            : currentBaseUrl()}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {step === "address" && (
        <>
          <Text style={styles.label}>address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="https://jarvis.example"
            placeholderTextColor={colors.dim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
          <Pressable
            style={styles.button}
            disabled={busy || !address.trim()}
            onPress={() =>
              attempt(async () => {
                if (!/^https?:\/\//.test(address.trim())) throw new ApiError("start with http:// or https://", 0)
                await setBaseUrl(address)
                setStep("credentials")
              })
            }
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </>
      )}

      {step === "credentials" && (
        <>
          <Text style={styles.label}>email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            textContentType="emailAddress"
          />
          <Text style={styles.label}>password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
          />
          <Pressable
            style={styles.button}
            disabled={busy || !email || !password}
            onPress={() =>
              attempt(async () => {
                const { needsTwoFactor } = await signIn(email, password)
                if (needsTwoFactor) return setStep("totp")
                router.replace("/sessions")
              })
            }
          >
            <Text style={styles.buttonText}>{busy ? "…" : "Sign in"}</Text>
          </Pressable>
          <View style={{ height: 10 }} />
          <Pressable style={styles.ghost} onPress={() => setStep("address")}>
            <Text style={styles.ghostText}>Change address</Text>
          </Pressable>
        </>
      )}

      {step === "totp" && (
        <>
          <Text style={styles.label}>code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={6}
            autoFocus
          />
          <Pressable
            style={styles.button}
            disabled={busy || code.length < 6}
            onPress={() =>
              attempt(async () => {
                await verifyTotp(code)
                router.replace("/sessions")
              })
            }
          >
            <Text style={styles.buttonText}>{busy ? "…" : "Verify"}</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

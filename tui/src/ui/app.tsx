import { rmSync } from "node:fs"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEFAULT_AGENT, loadAgents, resolveAgent } from "../agent/agent-def.ts"
import { withHostedFallback } from "../agent/hosted.ts"
import { forgetProvider, listModels } from "../agent/provider.ts"
import { claimPrompt } from "../agent/remote-prompt.ts"
import { deleteSession, type Session } from "../agent/session.ts"
import { loadConfig, type Config } from "../config/config.ts"
import { describe, matches, type Action, type Keymap } from "../config/keybinds.ts"
import { loadTheme, type Theme } from "../config/theme.ts"
import { loadCommands, parseCommandLine } from "../extend/command.ts"
import type { Extensions } from "../extend/extensions.ts"
import type { McpSession } from "../extend/mcp.ts"
import { discoverModels, discoveryArgs } from "../agent/model-discovery.ts"
import { testProvider, testWillInstall } from "../agent/provider-test.ts"
import { credentialsPath, isPaired, readCredentials, writeCredentials } from "../blueprint/credentials.ts"
import { blueprintRoot } from "../blueprint/store.ts"
import { applyWrites, checkEntry, checkMerged } from "../config/provider-plan.ts"
import { providerHealth } from "../config/provider-status.ts"
import { globalConfigFile, persistConfig } from "../config/persist.ts"
import { KEY_HELP, runCommand } from "./builtin-commands.ts"
import { testPanel, testPendingPanel } from "./provider-command.ts"
import {
  beginSetup,
  backStep,
  draftEntry,
  planWrites,
  stepSpec,
  submitStep,
  switchKeyMode,
  toggleModel,
  type Draft,
  type Setup,
  type SetupCtx,
} from "./provider-setup.ts"
import { useVim } from "./vim.ts"
import { Activity } from "./components/activity.tsx"
import { BlueprintEditor } from "./components/blueprint-editor.tsx"
import { BlueprintPane } from "./components/blueprint-view.tsx"
import { clip, PermissionPrompt, Picker, type Choice } from "./components/dialog.tsx"
import { Wizard, type TestState } from "./components/wizard.tsx"
import { PairWizard } from "./components/pair-wizard.tsx"
import {
  backStep as backPairStep,
  beginPair,
  stepSpec as pairStepSpec,
  submitStep as submitPairStep,
  type Pair,
  type PairCtx,
} from "./pair-setup.ts"
import {
  defaultDeviceName,
  fingerprint,
  PairCancelled,
  platformLabel,
  pollForToken,
  requestCode,
  type CodeResponse,
} from "../cli/pair-flow.ts"
import { Editor, type EditorHandle } from "./components/editor.tsx"
import { Messages } from "./components/messages.tsx"
import { Status } from "./components/status.tsx"
import { Suggestions } from "./components/suggestions.tsx"
import { Toasts, useToasts } from "./components/toast.tsx"
import { Panel, panelBody, type PanelContent } from "./components/panel.tsx"
import { tutorialContent } from "./tutorial.ts"
import { Welcome } from "./components/welcome.tsx"
import { gitEmail, readGit } from "./git.ts"
import { findPreset, HOSTED_PRESET_ID } from "./provider-presets.ts"
import type { MotionLevel } from "./motion.ts"
import { ADD_PROVIDER, listFiles, pickerChoices, PICKER_TITLES, type PickerKind } from "./pickers.ts"
import { completion, suggest, type Suggestion } from "./suggest.ts"
import { activeBlueprint, type Item, type Note } from "./transcript.ts"
import { errorMessage } from "../agent/agent.ts"
import { useTurn } from "./use-turn.ts"

export type AppProps = {
  config: Config
  cwd: string
  session: Session
  mcp: McpSession
  extensions: Extensions
  /** Startup warnings and first-run guidance, shown as notes in the transcript. */
  notes: string[]
  theme: Theme
  motion: MotionLevel
  keymap: Keymap
  model?: string
  agent?: string
  /** Nothing is configured, so open the provider flow on the first paint. */
  autoSetup?: boolean
  /** First run on an unpaired machine: open the pairing flow before asking for a key. */
  autoPair?: boolean
}

const SCROLL_LINES = 10
const QUIT_WINDOW_MS = 2000
/** How often an idle session asks the cloud whether anybody typed something for it. */
const STEER_POLL_MS = 5000
/** How long the status line acknowledges an auto-copied selection. */
const COPIED_MS = 1500

export function App({ cwd, mcp, extensions, keymap, notes, motion, ...initial }: AppProps) {
  const { width, height } = useTerminalDimensions()
  /**
   * State, not a prop: adding a provider from inside the app writes the config file, and
   * everything downstream of it — the model picker's list, the turn's provider options — has to
   * see that without a restart. `reloadConfig` is the only writer.
   */
  const [config, setConfig] = useState(initial.config)
  const agents = useMemo(() => loadAgents(config, cwd), [config, cwd])
  const commands = useMemo(() => loadCommands(cwd), [cwd])
  // One filesystem walk per session; the picker and the `@` strip both read this list.
  const files = useMemo(() => listFiles(cwd), [cwd])

  const [theme, setTheme] = useState(initial.theme)
  const [agent, setAgent] = useState(initial.agent ?? DEFAULT_AGENT)
  const [model, setModel] = useState(
    // No providers configured is a valid first-run state; the note in the transcript
    // explains it, so show a placeholder instead of refusing to start.
    () =>
      initial.model ??
      agents[initial.agent ?? DEFAULT_AGENT]?.model ??
      // The last model switched to in the TUI, written back to the global config.
      config.model ??
      listModels(config)[0]?.id ??
      "no model",
  )
  const [picker, setPicker] = useState<PickerKind | null>(null)
  /**
   * Built once per open, not per render: the component re-renders on every keystroke while
   * you filter, and a listing that spawns git or walks the disk on each one is a visible stall.
   */
  const choices = useMemo(
    () => (picker ? pickerChoices(picker, { config, cwd, agents, commands, files }) : []),
    [agents, commands, config, cwd, files, picker],
  )
  /** Read-only overlay content: the tutorial, or /provider output. */
  const [panel, setPanel] = useState<PanelContent | null>(null)
  /**
   * The provider setup flow. A third overlay, mutually exclusive with the other two by
   * construction: `Modal` has no backdrop and a fixed zIndex, so two open at once interleave.
   */
  const [setup, setSetup] = useState<Setup | null>(null)
  /**
   * The pairing flow. A fourth overlay, mutually exclusive with the others for the same
   * reason: `Modal` has no backdrop and a fixed zIndex, so two open at once interleave.
   */
  const [pairing, setPairing] = useState<Pair | null>(null)
  /**
   * The live pairing, readable from inside the poll effect without making it a dependency.
   * The countdown rewrites `pairing` on a timer; depending on it there would restart the
   * request every tick.
   */
  const pairingRef = useRef<Pair | null>(null)
  pairingRef.current = pairing
  /** The issued code, kept out of state so a re-render cannot lose the device code. */
  const pendingCode = useRef<CodeResponse | null>(null)
  /** A preset the reader chose that needed pairing first, to resume once pairing lands. */
  const resumeSetupWith = useRef<string | null>(null)
  /** Models offered at the setup flow's model step, filled in asynchronously. */
  const [discovered, setDiscovered] = useState<{ loading: boolean; models: Choice[]; note?: string }>({
    loading: false,
    models: [],
  })
  /** The setup flow's connection test. Null means "not started for this draft". */
  const [tested, setTested] = useState<TestState | null>(null)
  /** Bumped to run the test again. A counter, because "retry" repeats a request that did not change. */
  const [attempt, setAttempt] = useState(0)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [selected, setSelected] = useState(0)
  const [quitting, setQuitting] = useState(false)
  /** Whether thinking blocks are unfolded. One switch for all of them — the transcript has no cursor to expand just one. */
  const [thinking, setThinking] = useState(false)
  /**
   * How much of the blueprint the agent is working on is on screen. One tri-state rather
   * than two switches: there are three things a reader wants — out of the way, beside the
   * transcript, or filling the terminal — and they are steps along one axis.
   */
  const [blueprintView, setBlueprintView] = useState<"hidden" | "pane" | "full">("hidden")
  /** Set once the pane has opened itself, so a reader who closed it is not reopened on. */
  const offered = useRef(false)
  /** Whether the arming press also killed a turn, so the hint can say both things happened. */
  const [interrupted, setInterrupted] = useState(false)
  const { toasts, toast } = useToasts()
  // The agent checks out branches and edits files, so a value read once at startup goes stale
  // mid-session. Refreshed between turns instead: one spawn per turn, never during one.
  const [git, setGit] = useState(() => readGit(cwd))

  const turn = useTurn({ config, cwd, extensions, mcpTools: mcp.tools, session: initial.session, notes, agent, model })
  const editor = useRef<EditorHandle>(null)
  const scroll = useRef<ScrollBoxRenderable>(null)
  const history = useRef<string[]>([])
  // The agent and model as of the last switch. Key repeat batches several presses into one
  // React commit, so cycling has to read these rather than the state it is about to set.
  const activeAgent = useRef(agent)
  const activeModel = useRef(model)
  const browse = useRef({ index: -1, draft: "" })
  // A prompt claimed from the web app but not yet handed to `send`. A claim is spent
  // server-side, so this is the only copy that exists once the request has returned.
  const parked = useRef<{ session: string; prompt: string } | null>(null)

  // The config value is available before the first turn; the turn's value can also come
  // from the models.dev catalog, so it wins once a turn has actually resolved the model.
  const empty = turn.items.length === 0

  /**
   * The blueprint the agent is working on, and a token that changes whenever it may have
   * changed on disk.
   *
   * See `activeBlueprint` for why it is read out of the transcript rather than plumbed
   * through from the tools.
   */
  const blueprint = useMemo(() => activeBlueprint(turn.items), [turn.items])

  const blueprints = useMemo(() => blueprintRoot(config), [config])
  /** The pane needs about 40 columns of transcript left over to be worth showing. */
  const paneWidth = Math.min(48, Math.floor(width * 0.4))
  const paneFits = width - paneWidth > 52

  // Opens itself the first time the agent touches a blueprint — the point of the pane is
  // that a turn spent drawing is visible without being asked for. Once only: a reader who
  // closed it has said what they want.
  useEffect(() => {
    if (!blueprint || offered.current) return
    offered.current = true
    setBlueprintView(paneFits ? "pane" : "full")
  }, [blueprint, paneFits])
  const configured = useMemo(() => listModels(config).find((m) => m.id === model)?.contextLimit, [config, model])
  // Re-reads the config files to recover the `{env:…}` names behind the keys, so it is memoized
  // rather than computed per render.
  const health = useMemo(() => providerHealth(config, cwd), [config, cwd])
  const contextLimit = turn.contextLimit ?? configured
  const vim = useVim(editor, config.vim)

  useEffect(() => {
    if (turn.busy) return
    setGit(readGit(cwd))
  }, [turn.busy, cwd])

  /**
   * Prompts typed into the paired web app, run here.
   *
   * Only between turns — polling during one would interleave a second prompt into a running
   * agent loop — and only with `remoteSteering` on, because this is somebody else's keyboard
   * reaching this machine. What arrives goes through `send` like anything typed locally, so
   * the permission gate still stands in front of every tool call it provokes.
   *
   * A claimed prompt is spent server-side: the server has already marked it delivered and
   * will never hand it out again. So a request still in flight when this effect is torn down —
   * which happens every time a turn starts locally — parks its prompt rather than dropping it,
   * and the next idle run picks it up. Keyed by session, because the one outcome worse than
   * losing a prompt is running it in a conversation it was not written for.
   */
  useEffect(() => {
    if (!config.remoteSteering || turn.busy) return
    const id = turn.session.id
    let live = true

    const deliver = (prompt: string) => {
      if (!live) {
        parked.current = { session: id, prompt }
        return
      }
      parked.current = null
      turn.note("prompt from the web app")
      turn.send(prompt)
    }

    // Whatever a previous run parked goes before anything new is claimed. A prompt written
    // for a session that is no longer open cannot be delivered anywhere, so it is dropped
    // out loud rather than silently or into the wrong transcript.
    const held = parked.current
    if (held) {
      parked.current = null
      if (held.session === id) deliver(held.prompt)
      else turn.note(`a prompt from the web app was lost when session ${held.session} closed`, "error")
    }

    const timer = setInterval(() => {
      void claimPrompt(id).then((prompt) => {
        if (prompt) deliver(prompt)
      })
    }, STEER_POLL_MS)

    return () => {
      live = false
      clearInterval(timer)
    }
  }, [config.remoteSteering, turn.busy, turn.session.id, turn.send, turn.note])

  // An error note lands at the bottom of a transcript the user may have scrolled away from,
  // so it can go unseen for the rest of the turn. Toast the newest one as well.
  const lastError = useRef<Note | undefined>(undefined)
  useEffect(() => {
    const isError = (item: Item): item is Note => item.kind === "note" && item.level === "error"
    const latest = turn.items.findLast(isError)
    if (!latest || latest === lastError.current) return
    lastError.current = latest
    toast(latest.text, "error")
  }, [turn.items, toast])

  /**
   * Selecting text copies it, the way a terminal's own primary selection works — reaching
   * for a copy key after highlighting a path or an error is pure friction. OSC 52 so it
   * reaches the real clipboard even over ssh.
   */
  const renderer = useRenderer()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const onSelection = () => {
      const selection = renderer.getSelection()
      // Fires continuously while dragging; only the finished selection is worth copying.
      if (!selection || selection.isDragging) return
      const text = selection.getSelectedText()
      if (!text) return
      if (!renderer.copyToClipboardOSC52(text)) return
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_MS)
    }
    renderer.on("selection", onSelection)
    return () => void renderer.off("selection", onSelection)
  }, [renderer])

  /** The one place a model is switched, so no caller can leave the ref behind the state. */
  const selectModel = useCallback(
    (value: string) => {
      activeModel.current = value
      setModel(value)
      // A switch is a preference, not a per-session whim: the next start opens on it.
      try {
        persistConfig(globalConfigFile(), ["model"], value)
      } catch (error) {
        toast(`could not save model: ${errorMessage(error)}`, "warn")
      }
    },
    [toast],
  )

  /**
   * Re-reads the config from disk after something in the app has written to it.
   *
   * This is what makes "add a provider" work without a restart. Every consumer of `config`
   * already lists it as a dependency, so a new object identity is enough: the model picker's
   * list, the context-limit lookup, `useTurn`'s send, and the agent definitions all re-derive.
   *
   * `mcp` and `extensions` are deliberately *not* refreshed — they are loaded once at startup
   * and a provider write cannot affect them. Reloading them would tear down live MCP sessions
   * for nothing.
   */
  const reloadConfig = useCallback(
    (changed?: string) => {
      try {
        const next = withHostedFallback(loadConfig(cwd))
        // The cached factory was built from the old options; without this the next turn would
        // keep using the key that was just replaced.
        forgetProvider(changed)
        setConfig(next)
        // The model state initializer runs once, so a model that no longer exists — or a first
        // model where there were none — has to be picked up explicitly.
        const ids = listModels(next).map((entry) => entry.id)
        if (ids.length > 0 && !ids.includes(activeModel.current)) selectModel(ids[0]!)
        return true
      } catch (error) {
        // Keep the config that was working. A bad write should cost the reader a message, not
        // the session they were in the middle of.
        toast(errorMessage(error), "error")
        return false
      }
    },
    [cwd, selectModel, toast],
  )

  const setupCtx = useMemo<SetupCtx>(
    () => ({ existing: Object.keys(config.provider), paired: isPaired(), discovered: discovered.models }),
    [config.provider, discovered.models],
  )

  const openSetup = useCallback(
    (presetID?: string) => {
      setPicker(null)
      setPanel(null)
      setDiscovered({ loading: false, models: [] })
      setTested(null)
      const context: SetupCtx = { existing: Object.keys(config.provider), paired: isPaired() }
      const started = beginSetup(context)
      // A preset named up front skips the first question, which is what makes the "＋ add a
      // provider" row in the picker land on something useful rather than back at the top.
      setSetup(presetID ? submitStep(started, presetID, context) : started)
    },
    [config.provider],
  )

  const openPair = useCallback(() => {
    setPicker(null)
    setPanel(null)
    setSetup(null)
    const existing = readCredentials()
    const context: PairCtx = {
      existing: existing && {
        deviceId: existing.deviceId,
        workstationId: existing.workstationId,
        baseUrl: existing.baseUrl,
        name: existing.name,
      },
      knownBaseUrl: process.env.JARVIS_CLOUD_URL ?? config.cloud,
      knownEmail: gitEmail(cwd),
      defaults: { name: existing?.name ?? defaultDeviceName(), fingerprint: fingerprint(), platform: platformLabel() },
    }
    pendingCode.current = null
    const started = beginPair(context)
    setPairing(
      existing
        ? { ...started, paired: { deviceId: existing.deviceId, workstationId: existing.workstationId, name: existing.name ?? "" } }
        : started,
    )
  }, [config.cloud, cwd])

  /**
   * Drives the waiting step: ask for a code, then poll until a human approves.
   *
   * Keyed on the step and the code rather than on `pairing` itself — the countdown writes to
   * `pairing` several times a minute, and depending on the whole object would tear the poll
   * down and start a fresh request on every tick.
   */
  const pairStep = pairing?.step
  const pairCode = pairing?.code?.userCode
  useEffect(() => {
    if (pairStep !== "waiting") return
    const controller = new AbortController()

    void (async () => {
      try {
        let code: CodeResponse
        if (!pairCode) {
          const draft = pairingRef.current!.draft
          code = await requestCode(draft.baseUrl, { name: draft.name, email: draft.email || undefined })
          if (controller.signal.aborted) return
          setPairing((current) =>
            current && current.step === "waiting"
              ? {
                  ...current,
                  code: {
                    userCode: code.userCode,
                    verificationUri: code.verificationUri,
                    verificationUriComplete: code.verificationUriComplete,
                    qr: code.qr,
                  },
                  secondsLeft: code.expiresIn,
                }
              : current,
          )
        } else {
          code = pendingCode.current!
        }
        pendingCode.current = code

        const draft = pairingRef.current!.draft
        const paired = await pollForToken(draft.baseUrl, code, {
          signal: controller.signal,
          onTick: (secondsLeft) =>
            setPairing((current) => (current?.step === "waiting" ? { ...current, secondsLeft } : current)),
        })
        writeCredentials({
          baseUrl: draft.baseUrl,
          deviceId: paired.deviceId,
          token: paired.token,
          workstationId: paired.workstationId,
          name: paired.name || draft.name,
        })
        if (controller.signal.aborted) return
        setPairing((current) =>
          current ? { ...current, step: "done", paired: { ...paired } } : current,
        )
        toast(`paired as ${paired.deviceId}`)
      } catch (error) {
        if (controller.signal.aborted || error instanceof PairCancelled) return
        setPairing(null)
        turn.note(`pairing failed: ${error instanceof Error ? error.message : String(error)}`, "error")
      }
    })()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairStep, pairCode])

  /**
   * Closes the pairing overlay, honouring whatever was waiting on it.
   *
   * `paired` distinguishes the two exits: finishing resumes the exact preset the reader
   * chose, while backing out still opens the provider flow, because a first run that
   * cancels pairing has no model either way and must not be left facing an empty prompt.
   */
  const closePairing = useCallback(
    (paired: boolean) => {
      setPairing(null)
      const resume = resumeSetupWith.current
      resumeSetupWith.current = null
      if (resume) openSetup(paired ? resume : undefined)
    },
    [openSetup],
  )

  const advancePair = useCallback(
    (value: string) => {
      if (!pairing) return
      if (pairing.step === "status") {
        if (value === "unpair") {
          rmSync(credentialsPath, { force: true })
          turn.note(
            `unpaired — ${credentialsPath} removed. Its token stays valid until you revoke it under Settings → Devices.`,
          )
          return closePairing(false)
        }
        return closePairing(false)
      }
      // Now paired, so `presetChoices` and the draft's key mode both resolve differently.
      if (pairing.step === "done") return closePairing(true)
      setPairing(submitPairStep(pairing, value))
    },
    [closePairing, pairing, turn],
  )

  /**
   * Looks up what the chosen provider offers, as soon as there is enough to ask with. Runs on
   * arriving at the models step rather than eagerly, so a key typed and then corrected is not
   * spent on a list request that will fail.
   *
   * The dependencies are the individual draft fields the request is built from, deliberately
   * *not* `setup` itself. Toggling a model changes `setup`, and re-running on that would abort
   * the lookup and blank the list out from under the reader mid-selection.
   */
  const onModelsStep = setup?.step === "models"
  const askWith = setup ? discoveryArgs(setup.draft) : undefined
  const askKey = JSON.stringify(askWith ?? null)
  useEffect(() => {
    if (!onModelsStep || !askWith) return
    const controller = new AbortController()
    setDiscovered({ loading: true, models: [] })
    void discoverModels(askWith, controller.signal).then(({ models, note }) => {
      if (controller.signal.aborted) return
      setDiscovered({
        loading: false,
        models: models.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.hint })),
        note,
      })
    })
    return () => controller.abort()
    // askKey stands in for askWith, which is a fresh object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onModelsStep, askKey])

  // A first run has nothing to type a prompt into usefully, so the flow is the screen. Opened
  // in an effect rather than as the initial state so the transcript note behind it is already
  // rendered when the reader cancels out.
  const autoOpened = useRef(false)
  useEffect(() => {
    if ((!initial.autoSetup && !initial.autoPair) || autoOpened.current) return
    autoOpened.current = true
    // Pairing first when both are pending: its `done` step chains into the provider flow, so
    // opening both here would put two overlays on the same zIndex.
    if (initial.autoPair) {
      resumeSetupWith.current = HOSTED_PRESET_ID
      openPair()
    }
    else openSetup()
  }, [initial.autoPair, initial.autoSetup, openPair, openSetup])

  /** Runs the round-trip when the flow reaches its check step. */
  useEffect(() => {
    if (!setup || setup.step !== "test") return
    const { entry } = draftEntry(setup.draft)
    const controller = new AbortController()
    setTested({ running: true, installing: testWillInstall(entry) })
    // The typed key travels as an argument, never through the entry: what gets written still
    // holds only the `{secret:…}` reference.
    const key = setup.draft.keyMode === "store" ? setup.draft.key : undefined
    void testProvider({ config, cwd, id: setup.draft.id, entry, key, signal: controller.signal }).then((outcome) => {
      // A genuine cancel — esc, or leaving the step — and the outcome belongs to a draft nobody
      // is looking at any more.
      if (controller.signal.aborted) return
      setTested({ running: false, outcome })
    })
    return () => controller.abort()
    // `tested` is deliberately absent, for the same reason `discovered` is absent above: this
    // effect writes it, and depending on its own write makes the cleanup abort the request it
    // started one render earlier — leaving the step spinning on a result that was thrown away.
    // `attempt` is what re-runs it.
  }, [config, cwd, setup, attempt])

  /** Writes the draft, then reloads so the new provider is usable in this session. */
  const saveSetup = useCallback(
    (draft: Draft) => {
      const { id, entry } = draftEntry(draft)
      const checked = checkEntry(entry)
      // Checked before anything is written, so a bad draft costs a message rather than a config
      // that fails to parse on the next launch.
      if (!checked.ok) return toast(`cannot save: ${checked.problems.join("; ")}`, "error")
      const model = listModels(config).length === 0 && draft.models[0] ? `${id}/${draft.models[0]}` : undefined
      const merged = checkMerged(config, id, checked.entry, model)
      if (!merged.ok) return toast(`cannot save: ${merged.problems.join("; ")}`, "error")

      applyWrites(planWrites(draft, { setDefaultModel: model !== undefined }), globalConfigFile())
      setSetup(null)
      setTested(null)
      if (reloadConfig(id) && draft.models[0]) selectModel(`${id}/${draft.models[0]}`)
      toast(`${id} is ready`, "info")
    },
    [config, reloadConfig, selectModel, toast],
  )

  /** One answer from the flow. Every rule about what it means lives in the reducer. */
  const advanceSetup = useCallback(
    (value: string) => {
      if (!setup) return
      /**
       * The hosted provider needs a paired device, and is now offered to unpaired ones too.
       * Picking it hands off to the pairing flow and remembers where to come back to, so the
       * answer to "I want the one with no API key" is the flow that grants it rather than a
       * refusal pointing at a shell command.
       */
      if (setup.step === "preset" && findPreset(value)?.requiresPairing && !isPaired()) {
        resumeSetupWith.current = value
        return openPair()
      }
      if (setup.step === "test") {
        if (value === "cancel") return setSetup(null)
        if (value === "retry") {
          setTested(null)
          return setAttempt((n) => n + 1)
        }
        if (value === "key") {
          setTested(null)
          return setSetup(switchKeyMode({ ...setup, step: "key" }, "store"))
        }
        return saveSetup(setup.draft)
      }
      setSetup(submitStep(setup, setup.step === "models" ? setup.draft.models : value, setupCtx))
    },
    [openPair, saveSetup, setup, setupCtx],
  )

  /**
   * Runs a real round-trip against a configured provider and shows the outcome. Async, which is
   * why it lives here rather than in the synchronous command table: the panel opens immediately
   * with a pending message so an install does not look like a hang.
   */
  const runTest = useCallback(
    (id: string) => {
      const entry = config.provider[id]
      if (!entry) return
      setPanel(testPendingPanel(id, testWillInstall(entry)))
      void testProvider({ config, cwd, id, entry }).then((outcome) => setPanel(testPanel(id, outcome)))
    },
    [config, cwd],
  )

  const dispatch = useCallback(
    (name: string, args: string) => {
      const command = commands.find((entry) => entry.name === name)
      if (!command) return turn.note(`unknown command /${name} — try /help`, "error")
      runCommand(command, args, {
        turn,
        keymap,
        mcp,
        extensions,
        config,
        cwd,
        width,
        openPicker: setPicker,
        openPanel: setPanel,
        openSetup,
        openPair,
        reload: reloadConfig,
        testProvider: runTest,
        quit: () => process.exit(0),
      })
    },
    [commands, config, cwd, extensions, keymap, mcp, openPair, openSetup, reloadConfig, runTest, turn, width],
  )

  const shell = useCallback(
    (command: string) => {
      if (!command) return
      const result = Bun.spawnSync(["bash", "-c", command], { cwd, env: { ...process.env, JARVIS: "1" } })
      const output = [result.stdout.toString(), result.stderr.toString()].filter((part) => part.trim()).join("\n")
      turn.note(`! ${command}\n${output.trimEnd() || `(exit ${result.exitCode})`}`, result.exitCode === 0 ? "info" : "error")
    },
    [cwd, turn],
  )

  const submit = useCallback(
    (text: string) => {
      history.current.push(text)
      browse.current = { index: -1, draft: "" }
      setSuggestion(null)
      vim.reset()
      // `!cmd` runs a shell command without spending a turn on it, for the constant
      // small checks — git status, a test run — that do not need the model at all.
      if (text.startsWith("!")) return shell(text.slice(1).trim())
      const parsed = parseCommandLine(text)
      if (parsed) dispatch(parsed.name, parsed.args)
      else turn.send(text)
    },
    [dispatch, shell, turn],
  )

  const change = useCallback(
    (text: string) => {
      const next = suggest(text, commands, files) ?? null
      // Typing prose is the common case: keep the same reference so React can bail out
      // instead of reconciling the whole transcript on every keystroke.
      setSuggestion((current) => (current === null && next === null ? current : next))
      setSelected(0)
    },
    [commands, files],
  )

  const accept = useCallback(() => {
    const value = suggestion && completion(suggestion, selected)
    if (!suggestion || !value) return
    editor.current?.replaceToken(suggestion.token, value)
    setSuggestion(null)
  }, [selected, suggestion])

  /** Walks the prompt history, keeping the half-written draft to come back to. */
  const recall = useCallback((direction: -1 | 1) => {
    const entries = history.current
    const state = browse.current
    if (entries.length === 0) return
    if (state.index === -1) {
      if (direction === 1) return
      state.draft = editor.current?.text() ?? ""
      state.index = entries.length - 1
    } else {
      const next = state.index + direction
      if (next >= entries.length) {
        state.index = -1
        editor.current?.set(state.draft)
        return
      }
      if (next < 0) return
      state.index = next
    }
    editor.current?.set(entries[state.index]!)
  }, [])

  /** The one place an agent is switched, so the picker and the arrow keys cannot diverge. */
  const selectAgent = useCallback(
    (value: string) => {
      activeAgent.current = value
      setAgent(value)
      const chosen = resolveAgent(agents, value)
      if (chosen.model) selectModel(chosen.model)
    },
    [agents, selectModel],
  )

  /**
   * Steps through a list of names, wrapping. Shared by the agent and model cycles because the
   * only thing that differs is the list: both read a ref rather than the state they are about
   * to set, since key repeat lands several presses inside one React batch and a stale read
   * would make every press in the batch pick the same target.
   */
  const step = (names: string[], from: string, direction: -1 | 1): string | undefined => {
    if (names.length < 2) return undefined
    const index = names.indexOf(from)
    // A name from the command line need not be in the list; start from the top.
    return index === -1 ? names[0] : names[(index + direction + names.length) % names.length]
  }

  const cycleAgent = useCallback(
    (direction: -1 | 1) => {
      const next = step(Object.keys(agents), activeAgent.current, direction)
      if (next) selectAgent(next)
    },
    [agents, selectAgent],
  )

  const cycleModel = useCallback(
    (direction: -1 | 1) => {
      // The picker's order, so tab and ctrl+o agree on what "next" means.
      const next = step(
        listModels(config).map((entry) => entry.id),
        activeModel.current,
        direction,
      )
      if (next) selectModel(next)
    },
    [config, selectModel],
  )

  /**
   * Deletes a session from the picker. The live one is refused rather than deleted: the turn
   * in flight would keep appending to a file that no longer exists, and the user would have
   * no way back to the conversation on screen.
   */
  const removeSession = useCallback(
    (id: string) => {
      if (id === turn.session.id) return toast("that is the session you are in", "warn")
      toast(deleteSession(id) ? "session deleted" : "session was already gone", "info")
    },
    [toast, turn.session.id],
  )

  const pick = useCallback(
    (value: string) => {
      const kind = picker
      setPicker(null)
      switch (kind) {
        case "model":
          return selectModel(value)
        case "agent":
          return selectAgent(value)
        case "session":
          return turn.resume(value)
        case "command":
          return dispatch(value, "")
        case "theme":
          return setTheme(loadTheme(value, cwd))
        case "file":
          editor.current?.insert(value)
          return
        case "provider":
          if (value === ADD_PROVIDER) return openSetup()
          return dispatch("provider", `view ${value}`)
        case "blueprint":
          return dispatch("blueprint", value)
        default:
          return
      }
    },
    [cwd, dispatch, openSetup, picker, selectAgent, selectModel, turn],
  )

  // The permission prompt and the picker own the keyboard while they are open. Everything
  // else is dispatched here first — these handlers run before the focused textarea sees
  // the key, so `stopPropagation` is what keeps the completion strip from also typing.
  useKeyboard((key) => {
    const is = (action: Action) => matches(key, keymap[action])

    // Quitting outranks every overlay. An open picker or panel used to swallow ctrl+c
    // entirely, which is the same trap a running turn used to be: the moments you most want
    // out are the ones where nothing was listening.
    if (is("exit")) {
      if (quitting) process.exit(0)
      setInterrupted(turn.interrupt())
      setQuitting(true)
      setTimeout(() => setQuitting(false), QUIT_WINDOW_MS)
      return key.stopPropagation()
    }

    // Otherwise the prompt and the overlays own the keyboard; each closes itself.
    if (turn.permission || turn.question || picker || panel || setup || blueprintView === "full") return

    // Normal-mode keys are commands, not text, so vim gets the first look. It declines
    // anything it does not map — including ctrl chords and everything in insert mode.
    if (vim.handle(key)) return key.stopPropagation()

    if (suggestion) {
      const count = suggestion.choices.length
      if (key.name === "up" || key.name === "down") {
        setSelected((index) => (index + (key.name === "up" ? count - 1 : 1)) % count)
        return key.stopPropagation()
      }
      if (is("acceptSuggestion")) {
        accept()
        return key.stopPropagation()
      }
      // Enter completes too — reaching for tab is friction when the strip is already
      // showing what you meant. An exact match is the exception: `/clear` is fully typed,
      // so Enter there means send, and swallowing it would demand a second press.
      if (is("submit")) {
        const value = completion(suggestion, selected)
        if (value && value !== suggestion.token) {
          accept()
          return key.stopPropagation()
        }
        setSuggestion(null)
      }
      if (key.name === "escape") {
        setSuggestion(null)
        return key.stopPropagation()
      }
    }

    if ((key.name === "up" || key.name === "down") && !key.ctrl && !key.meta) {
      if (editor.current?.atEdge(key.name === "up" ? "first" : "last")) {
        recall(key.name === "up" ? -1 : 1)
        return key.stopPropagation()
      }
    }

    // Left and right belong to the cursor whenever there is text to move through. An empty
    // buffer has none, so there they switch agents — the same trade up and down make with
    // history above. Not in the keymap for the same reason those are not: the binding is
    // only half a key, the other half is the state of the buffer.
    if ((key.name === "left" || key.name === "right") && !key.ctrl && !key.meta && !editor.current?.text()) {
      cycleAgent(key.name === "left" ? -1 : 1)
      return key.stopPropagation()
    }

    // Tab on an empty buffer steps the model. Forward only — shift+tab is the agent picker —
    // and safe to claim here because the completion strip already returned above when open.
    if (key.name === "tab" && !key.shift && !key.ctrl && !key.meta && !editor.current?.text()) {
      cycleModel(1)
      return key.stopPropagation()
    }

    if (is("interrupt")) turn.interrupt()
    else if (is("clear")) turn.clear()
    else if (is("palette")) setPicker("command")
    else if (is("tutorial")) setPanel(tutorialContent(keymap, KEY_HELP, panelBody(width)))
    else if (is("providerSetup")) dispatch("provider", "")
    else if (is("modelPicker")) setPicker("model")
    else if (is("agentPicker")) setPicker("agent")
    else if (is("sessionPicker")) setPicker("session")
    else if (is("filePicker")) setPicker("file")
    else if (is("newSession")) turn.newSession()
    else if (is("scrollUp")) scroll.current?.scrollBy({ x: 0, y: -SCROLL_LINES })
    else if (is("scrollDown")) scroll.current?.scrollBy({ x: 0, y: SCROLL_LINES })
    else if (is("scrollHalfUp")) scroll.current?.scrollBy({ x: 0, y: -Math.floor(height / 2) })
    else if (is("scrollHalfDown")) scroll.current?.scrollBy({ x: 0, y: Math.floor(height / 2) })
    else if (is("toggleReasoning")) setThinking((shown) => !shown)
    // hidden → pane → full → hidden, skipping the pane on a terminal too narrow to hold
    // both it and a readable transcript.
    else if (is("blueprintView"))
      setBlueprintView((current) =>
        current === "hidden" ? (paneFits ? "pane" : "full") : current === "pane" ? "full" : "hidden",
      )
    else if (is("scrollBottom")) scroll.current?.scrollTo({ x: 0, y: scroll.current.scrollHeight })
  })

  const welcome = (
    <Welcome
      theme={theme}
      keymap={keymap}
      cwd={cwd}
      git={git}
      model={model}
      agent={agent}
      empty={empty}
      needsProvider={listModels(config).length === 0}
    />
  )

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: theme.bg }}>
      {/* An empty session has nothing to scroll, so it gets a plain flex box that can centre
          the wordmark. The scrollbox cannot: it is anchored to the bottom and its content box
          hugs its children, so there is no free space inside it to centre against. */}
      {/* A row only so the pane can sit beside the transcript; everything below — the
          activity line, the editor, the status bar — keeps the full width. */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
      {blueprint && blueprintView === "pane" && paneFits && (
        <BlueprintPane
          root={blueprints}
          name={blueprint.name}
          revision={blueprint.revision}
          theme={theme}
          width={paneWidth}
          height={height - 6}
        />
      )}
      {empty ? (
        <box style={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}>{welcome}</box>
      ) : (
        <scrollbox
          ref={scroll}
          stickyScroll
          stickyStart="bottom"
          style={{
            flexGrow: 1,
            rootOptions: { backgroundColor: theme.bg },
            viewportOptions: { backgroundColor: theme.bg },
            contentOptions: { backgroundColor: theme.bg, paddingLeft: 1, paddingRight: 1 },
            scrollbarOptions: { trackOptions: { foregroundColor: theme.border, backgroundColor: theme.bg } },
          }}
        >
          {welcome}
          <Messages
            items={turn.items}
            theme={theme}
            motion={motion}
            streaming={turn.busy}
            thinking={thinking}
          />
        </scrollbox>
      )}
      </box>

      {(turn.busy || turn.compacting) && (
        <Activity items={turn.items} theme={theme} motion={motion} keymap={keymap} compacting={turn.compacting} />
      )}

      {suggestion && !turn.permission && !turn.question && !picker && !setup && (
        <Suggestions suggestion={suggestion} selected={selected} theme={theme} />
      )}

      {turn.permission ? (
        <PermissionPrompt
          request={turn.permission.request}
          theme={theme}
          motion={motion}
          onAnswer={turn.permission.answer}
        />
      ) : (
        // The editor stays mounted under the picker so the half-written prompt behind the
        // modal is still visible, and is there again the moment the modal closes.
        <Editor
          theme={theme}
          keymap={keymap}
          motion={motion}
          busy={turn.busy}
          focused={!picker && !panel && !setup && !turn.question}
          handle={editor}
          onSubmit={submit}
          onChange={change}
        />
      )}

      {/* Under the input rather than under the list: the keys describe what enter and tab
          will do to the buffer, so they read best next to the buffer. */}
      {suggestion && !turn.permission && !turn.question && !picker && !setup && (
        // A box, not `paddingLeft` on the text: padding on a `<text>` is ignored, and the
        // line has to start where the editor's own text does or it reads as unrelated.
        <box style={{ paddingLeft: 2 }}>
          <text fg={theme.hint}>
            {`${describe(keymap.acceptSuggestion)} or ${describe(keymap.submit)} complete · esc dismiss`}
          </text>
        </box>
      )}

      {/* The `ask` tool's question. Same picker as everything else — a question with a
          known set of answers is a list to choose from, and escape means "stop asking",
          which the tool turns into an error telling the model to assume and say so. The
          title is clipped because an over-wide box title is dropped silently. */}
      {turn.question && !turn.permission && (
        <Picker
          title={clip(turn.question.question, 60)}
          choices={turn.question.options.map((option) => ({ value: option, label: option }))}
          theme={theme}
          motion={motion}
          onPick={turn.question.answer}
          onCancel={() => turn.question?.answer("")}
        />
      )}

      {pairing && !turn.permission && !turn.question && (
        <PairWizard
          pair={pairing}
          spec={pairStepSpec(pairing)}
          theme={theme}
          motion={motion}
          onSubmit={advancePair}
          onBack={() => setPairing(backPairStep(pairing))}
          onCancel={() => closePairing(false)}
        />
      )}

      {setup && !pairing && !turn.permission && !turn.question && (
        <Wizard
          setup={setup}
          spec={stepSpec(setup, setupCtx)}
          theme={theme}
          motion={motion}
          models={{ loading: discovered.loading, note: discovered.note }}
          result={tested ?? undefined}
          onSubmit={advanceSetup}
          onToggle={(value) => setSetup(toggleModel(setup, value))}
          onSwitchKeyMode={() => setSetup(switchKeyMode(setup, setup.draft.keyMode === "env" ? "store" : "env"))}
          onBack={() => {
            setTested(null)
            setSetup(backStep(setup))
          }}
          onCancel={() => {
            setSetup(null)
            setTested(null)
          }}
        />
      )}

      {picker && !turn.permission && !turn.question && !setup && (
        <Picker
          title={PICKER_TITLES[picker]}
          choices={choices}
          theme={theme}
          motion={motion}
          onPick={pick}
          onDelete={
            picker === "session"
              ? removeSession
              : picker === "provider"
                ? (id) => id !== ADD_PROVIDER && dispatch("provider", `delete ${id} yes`)
                : undefined
          }
          onCancel={() => setPicker(null)}
        />
      )}

      {/* The status line is panel-coloured and the editor no longer has a bottom border to
          end on, so without this row the input and the status run together as one block. */}
      <box style={{ height: 1 }} />

      <Status
        theme={theme}
        motion={motion}
        cwd={cwd}
        git={git}
        model={model}
        agent={agent}
        usage={turn.usage}
        contextLimit={contextLimit}
        contextTokens={turn.contextTokens}
        vim={vim.mode}
        busy={turn.busy || turn.compacting}
        width={width}
        warn={health.warning}
        hint={
          copied
            ? "copied to clipboard"
            : quitting
              ? // Two things can have just happened, and conflating them reads as if the
                // turn is still running.
                `${interrupted ? "interrupted · " : ""}${describe(keymap.exit)} again to exit`
              : `${describe(keymap.palette)} commands`
        }
      />

      {panel && <Panel content={panel} theme={theme} motion={motion} onClose={() => setPanel(null)} />}

      {blueprint && blueprintView === "full" && !picker && !panel && !setup && !pairing && !turn.permission && !turn.question && (
        <BlueprintEditor
          root={blueprints}
          name={blueprint.name}
          theme={theme}
          onClose={() => setBlueprintView("hidden")}
        />
      )}

      <Toasts toasts={toasts} theme={theme} motion={motion} />
    </box>
  )
}

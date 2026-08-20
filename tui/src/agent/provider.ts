import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { wrapLanguageModel, type LanguageModel } from "ai"
import type { Config, ModelConfig, ProviderConfig } from "../config/config.ts"
import { dataDir } from "../config/paths.ts"
import { catalogKey, modelInfo } from "./catalog.ts"

export class ProviderError extends Error {}

/** Where provider npm packages named in the config get installed on demand. */
const packageDir = join(dataDir, "packages")

/**
 * Providers linked into the binary at build time.
 *
 * A standalone executable built by `bun build --compile` resolves modules against its own
 * embedded `$bunfs` and does **no** node_modules lookup — not for a bare specifier, not
 * for an absolute path, and not for the transitive imports of a file it did manage to
 * load. So the install-on-demand path below cannot work there, however well the package
 * installed. The specifiers here are static string literals precisely so the bundler sees
 * them and links the packages in; a variable specifier would be left dynamic and fail.
 *
 * Anything not listed still installs on demand, which works when jarvis runs from source.
 */
const BUNDLED: Record<string, () => Promise<unknown>> = {
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible"),
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic"),
  "@ai-sdk/openai": () => import("@ai-sdk/openai"),
  "@ai-sdk/google": () => import("@ai-sdk/google"),
}

/** True when running as a compiled binary, where on-demand packages cannot be loaded. */
const COMPILED = import.meta.dir.startsWith("/$bunfs")

/**
 * Whether talking to this provider will need an install first. Exported so a caller can say
 * "installing @ai-sdk/… (first run, this can take a while)" *before* awaiting, rather than
 * leaving the reader watching a silent spinner.
 */
export function needsInstall(npm: string): boolean {
  if (npm in BUNDLED) return false
  try {
    // Resolvable from jarvis itself: nothing to install.
    Bun.resolveSync(npm, import.meta.dir)
    return false
  } catch {
    return !existsSync(join(packageDir, "node_modules", ...npm.split("/")))
  }
}

async function importPackage(npm: string): Promise<Record<string, unknown>> {
  const bundled = BUNDLED[npm]
  if (bundled) return (await bundled()) as Record<string, unknown>

  if (COMPILED) {
    throw new ProviderError(
      `${npm} cannot be loaded by the compiled jarvis binary — a standalone executable cannot resolve packages installed at runtime. ` +
        `Use one of ${Object.keys(BUNDLED).join(", ")}, or run jarvis from source with \`bun run start\`.`,
    )
  }

  try {
    return (await import(npm)) as Record<string, unknown>
  } catch {
    // not resolvable from jarvis itself — fall through to the managed dir
  }
  if (!existsSync(packageDir)) mkdirSync(packageDir, { recursive: true })
  const manifest = join(packageDir, "package.json")
  if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify({ name: "jarvis-packages", private: true }))

  // Bun.resolveSync falls back to the global install cache, where peer deps are not
  // wired up, so check for a real node_modules install instead of relying on it.
  if (!existsSync(join(packageDir, "node_modules", ...npm.split("/")))) {
    // AI SDK providers peer-depend on zod, so it has to be installed alongside them.
    //
    // Spawned, not spawnSync: this takes tens of seconds on a cold cache, and spawnSync blocks
    // the thread the TUI renders on — the whole app freezes, spinner included, with no way to
    // tell whether it is working or hung.
    const install = Bun.spawn(["bun", "add", npm, "zod"], { cwd: packageDir, stdout: "pipe", stderr: "pipe" })
    const [exitCode, stderr] = await Promise.all([install.exited, new Response(install.stderr).text()])
    if (exitCode !== 0) throw new ProviderError(`failed to install ${npm}: ${stderr.trim()}`)
  }
  return (await import(Bun.resolveSync(npm, packageDir))) as Record<string, unknown>
}

type ProviderFactory = (options: Record<string, unknown>) => unknown

function pickFactory(mod: Record<string, unknown>, name: string | undefined, npm: string): ProviderFactory {
  if (name) {
    const explicit = mod[name]
    if (typeof explicit !== "function") throw new ProviderError(`${npm} has no callable export "${name}"`)
    return explicit as ProviderFactory
  }
  const candidate = Object.entries(mod).find(([key, value]) => key.startsWith("create") && typeof value === "function")
  if (!candidate) throw new ProviderError(`${npm} exports no create* factory; set provider.export in the config`)
  return candidate[1] as ProviderFactory
}

/** AI SDK ProviderV2, or a bare callable provider from older packages. */
type Provider = ((modelID: string) => LanguageModel) & { languageModel?: (modelID: string) => LanguageModel }

const loaded = new Map<string, Promise<Provider>>()

/**
 * Drops a cached factory so the next `resolveModel` rebuilds it from the current config.
 * Needed because `/provider change` edits the config in place, and without this the old
 * factory — built with the old options — would keep serving every turn until a restart.
 */
export const forgetProvider = (providerID?: string): void => {
  if (providerID) loaded.delete(providerID)
  else loaded.clear()
}

function loadProvider(providerID: string, config: ProviderConfig): Promise<Provider> {
  const cached = loaded.get(providerID)
  if (cached) return cached
  const promise = (async () => {
    const mod = await importPackage(config.npm)
    const created: unknown = pickFactory(mod, config.export, config.npm)(config.options)
    const callable = typeof created === "function"
    const hasLanguageModel = typeof (created as Provider | undefined)?.languageModel === "function"
    if (!callable && !hasLanguageModel) {
      throw new ProviderError(`${config.npm} factory did not return an AI SDK provider`)
    }
    return created as Provider
  })()
  loaded.set(providerID, promise)
  return promise
}

export type ResolvedModel = {
  providerID: string
  modelID: string
  /** "providerID/modelID" — the string form used in config and the UI. */
  id: string
  model: LanguageModel
  info: ModelConfig
}

/** Splits on the first slash only, so model ids may themselves contain slashes. */
export function parseModelID(id: string): { providerID: string; modelID: string } {
  const slash = id.indexOf("/")
  if (slash <= 0 || slash === id.length - 1) {
    throw new ProviderError(`model "${id}" must be in "provider/model" form`)
  }
  return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) }
}

/**
 * Groq refuses the `reasoning_content` that `@ai-sdk/openai-compatible` puts back on an
 * assistant message the same gateway produced a moment earlier — its own field, rejected on
 * the way in — so step two of every multi-step turn 400s and nothing that needs a second
 * tool call can ever finish. The reasoning is display-only on this path, so dropping it
 * before it is sent costs nothing.
 *
 * Scoped to openai-compatible on purpose: Anthropic needs its thinking blocks handed back
 * intact or a tool-use turn fails signature verification.
 */
function withoutReasoning(model: LanguageModel): LanguageModel {
  if (typeof model === "string") return model
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        prompt: params.prompt.map((message) =>
          message.role === "assistant"
            ? { ...message, content: message.content.filter((part) => part.type !== "reasoning") }
            : message,
        ),
      }),
    },
  })
}

export async function resolveModel(config: Config, id: string): Promise<ResolvedModel> {
  const { providerID, modelID } = parseModelID(id)
  const providerConfig = config.provider[providerID]
  if (!providerConfig) {
    const known = Object.keys(config.provider).join(", ") || "none configured"
    throw new ProviderError(`unknown provider "${providerID}" (known: ${known})`)
  }
  if (!providerConfig.enabled) throw new ProviderError(`provider "${providerID}" is disabled`)
  const provider = await loadProvider(providerID, providerConfig)
  const created = provider.languageModel ? provider.languageModel(modelID) : provider(modelID)
  const model = providerConfig.npm === "@ai-sdk/openai-compatible" ? withoutReasoning(created) : created
  const configured = providerConfig.models[modelID] ?? {}
  // Nothing left for the catalog to add, so don't go looking.
  const complete = configured.contextLimit !== undefined && configured.cost !== undefined
  const known = complete ? {} : await modelInfo([providerID, catalogKey(providerConfig.npm)], modelID)
  return { providerID, modelID, id, model, info: { ...known, ...configured } }
}

/** Every model declared in the config, as "provider/model" ids. */
export function listModels(config: Config): { id: string; name: string; provider: string; contextLimit?: number }[] {
  return Object.entries(config.provider)
    .filter(([, provider]) => provider.enabled)
    .flatMap(([providerID, provider]) =>
      Object.entries(provider.models).map(([modelID, model]) => ({
        id: `${providerID}/${modelID}`,
        name: model.name ?? modelID,
        provider: provider.name ?? providerID,
        contextLimit: model.contextLimit,
      })),
    )
}

/** The model to use when the caller has no preference. */
export function defaultModelID(config: Config): string {
  if (config.model) return config.model
  const first = listModels(config)[0]
  // Points at the flow rather than at the file: setting a provider up by hand still works, but
  // it is no longer the way anyone should be told to do it first.
  if (!first) throw new ProviderError("no models configured — run `jarvis` and press ctrl+y, or `jarvis pair`")
  return first.id
}

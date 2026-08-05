// Bun-only: talks to the cloud and to the local git store.
import { merge3, type MergeResult } from "./merge.ts"
import { BlueprintDocSchema, BlueprintError, serialize, type BlueprintDoc } from "./schema.ts"
import { readCredentials, type Credentials } from "./credentials.ts"
import { docAt, history, readDoc, writeDoc, type Commit } from "./store.ts"

export type PushOutcome =
  | { status: "up-to-date"; head?: string }
  | { status: "pushed"; applied: number; head: string; version: number }
  | { status: "merged"; applied: number; head: string; conflicts: string[]; renamed: string[] }

type PushResponse = { success: true; applied: number; head: string | null; version?: number; upToDate?: boolean }
type DivergedResponse = {
  error: "diverged"
  serverHead: string
  serverParent: string | null
  serverVersion: number
  serverDoc: unknown
}

async function call<T>(
  credentials: Credentials,
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<{ ok: true; body: T } | { ok: false; status: number; body: unknown }> {
  const { idempotencyKey, ...rest } = init
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.token}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...rest.headers,
    },
  })
  const text = await response.text()
  const body: unknown = text ? JSON.parse(text) : {}
  if (!response.ok) return { ok: false, status: response.status, body }
  return { ok: true, body: body as T }
}

/** Oldest first, which is the order the server applies them in. */
function payload(root: string, name: string, doc: BlueprintDoc) {
  const log = [...history(root, name, 200)].reverse()
  return {
    blueprintId: doc.id,
    name,
    commits: log.map((commit, index) => ({
      sha: commit.sha,
      parentSha: index === 0 ? null : log[index - 1]!.sha,
      message: commit.message,
      at: commit.at,
      doc: docAt(root, name, commit.sha),
    })),
  }
}

/**
 * Pushes local commits. On a 409 the two histories have diverged: fetch the server's head
 * document, three-way merge it against ours using the common ancestor from local history,
 * commit the merge, and push that. Conflicts are reported, never resolved silently.
 */
export async function push(root: string, name: string, given?: Credentials): Promise<PushOutcome> {
  const credentials = given ?? readCredentials()
  if (!credentials) throw new BlueprintError("this device is not paired — run `jarvis pair` first")

  const doc = readDoc(root, name)
  const body = payload(root, name, doc)
  if (body.commits.length === 0) throw new BlueprintError(`${name} has no commits to push`)

  const first = await call<PushResponse>(credentials, "/api/blueprint/push", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: `${doc.id}:${body.commits.at(-1)!.sha}`,
  })

  if (first.ok) {
    if (first.body.upToDate) return { status: "up-to-date", head: first.body.head ?? undefined }
    return {
      status: "pushed",
      applied: first.body.applied,
      head: first.body.head ?? "",
      version: first.body.version ?? 0,
    }
  }

  if (first.status !== 409) {
    throw new BlueprintError(`push failed (${first.status}): ${JSON.stringify(first.body)}`)
  }

  const diverged = first.body as DivergedResponse
  const parsed = BlueprintDocSchema.safeParse(diverged.serverDoc)
  if (!parsed.success) throw new BlueprintError("the server's version of this blueprint is not a valid document")

  const merged = mergeWithServer(root, name, doc, parsed.data, diverged.serverParent)
  const message = [
    `merge ${diverged.serverHead}`,
    merged.conflicts.length > 0 ? `${merged.conflicts.length} conflict(s)` : undefined,
  ]
    .filter(Boolean)
    .join(" — ")
  writeDoc(root, name, merged.doc, message)

  // Only the merge commit, parented on the *server's* head — not the local chain.
  // Local history and server history genuinely differ now: the server holds a commit we
  // never had, so no local parent could satisfy its fast-forward check. The merge document
  // already contains that commit's content, which is exactly what makes this a valid
  // fast-forward from the server's point of view.
  const head = history(root, name, 1)[0]!
  const second = await call<PushResponse>(credentials, "/api/blueprint/push", {
    method: "POST",
    body: JSON.stringify({
      blueprintId: merged.doc.id,
      name,
      commits: [
        {
          sha: head.sha,
          parentSha: diverged.serverHead,
          message: head.message,
          at: head.at,
          doc: merged.doc,
        },
      ],
    }),
  })
  if (!second.ok) throw new BlueprintError(`push after merge failed (${second.status}): ${JSON.stringify(second.body)}`)

  return {
    status: "merged",
    applied: second.body.applied,
    head: second.body.head ?? "",
    conflicts: merged.conflicts.map((conflict) => conflict.note),
    renamed: merged.renamed.map((entry) => `${entry.from} → ${entry.to}`),
  }
}

/**
 * The merge base is the commit the server's head was built on — by definition we do not
 * have `serverHead` itself, but its parent is usually the last commit both sides shared.
 *
 * Getting this right matters more than it looks: with too old a base, an entity both sides
 * edited looks like an entity both sides *added*, and the conflict is reported as a
 * harmless rename instead of something a human should look at.
 */
function mergeWithServer(
  root: string,
  name: string,
  ours: BlueprintDoc,
  theirs: BlueprintDoc,
  serverParent: string | null,
): MergeResult {
  const log = history(root, name, 200)
  const shared = serverParent ? log.find((commit) => commit.sha === serverParent) : undefined
  // No shared commit at all means the two histories have nothing in common. The empty
  // first commit is the only honest base left, which makes every difference a separate
  // addition — nothing is dropped, but nothing is claimed to be a conflict either.
  const base = shared ? docAt(root, name, shared.sha) : docAt(root, name, log.at(-1)!.sha)
  return merge3(base, ours, theirs)
}

export type PullOutcome =
  | { status: "up-to-date" }
  | { status: "fast-forward"; head: string; version: number }
  | { status: "merged"; head: string; conflicts: string[]; renamed: string[] }

type PullResponse = {
  success: true
  name: string
  commits: { sha: string | null; parentSha: string | null; message: string | null; version: number; doc: unknown }[]
  truncated: boolean
}

/** Brings the server's newer versions down, merging when local work would be lost. */
export async function pull(root: string, name: string, given?: Credentials): Promise<PullOutcome> {
  const credentials = given ?? readCredentials()
  if (!credentials) throw new BlueprintError("this device is not paired — run `jarvis pair` first")

  const doc = readDoc(root, name)
  const local = history(root, name, 200)
  // The whole list, not `?since=`: after any previous pull our local head sha is one the
  // server has never seen, so `since` would be unknown anyway — and we need the full set
  // of server shas below to tell "we are simply behind" from "we both moved on".
  // ponytail: a blueprint history is a few hundred small JSON docs; switch to `since` with
  // a stored server version if a repo ever grows past that.
  const result = await call<PullResponse>(
    credentials,
    `/api/blueprint/pull?blueprintId=${encodeURIComponent(doc.id)}`,
  )
  if (!result.ok) throw new BlueprintError(`pull failed (${result.status}): ${JSON.stringify(result.body)}`)
  if (result.body.truncated) throw new BlueprintError("the server has more history than one pull can carry")

  const latest = result.body.commits.at(-1)
  if (!latest) return { status: "up-to-date" }

  const parsed = BlueprintDocSchema.safeParse(latest.doc)
  if (!parsed.success) throw new BlueprintError("the server sent a document that is not a valid blueprint")

  if (serialize(parsed.data) === serialize(doc)) return { status: "up-to-date" }

  // If the server has our local head, everything local is already up there and we are
  // purely behind — taking its version loses nothing. Otherwise we have unpushed work and
  // overwriting it would throw it away, so merge instead.
  const serverShas = new Set(result.body.commits.map((commit) => commit.sha))
  const localHead = local[0]?.sha
  if (localHead && !serverShas.has(localHead)) {
    const merged = merge3(docAt(root, name, local.at(-1)!.sha), doc, parsed.data)
    const sha = writeDoc(root, name, merged.doc, `merge server v${latest.version}`)
    return {
      status: "merged",
      head: sha,
      conflicts: merged.conflicts.map((conflict) => conflict.note),
      renamed: merged.renamed.map((entry) => `${entry.from} → ${entry.to}`),
    }
  }

  const sha = writeDoc(root, name, parsed.data, `pull server v${latest.version}`)
  return { status: "fast-forward", head: sha, version: latest.version }
}

export type SyncStatus = {
  paired: boolean
  baseUrl?: string
  deviceId?: string
  localHead?: string
  localCommits: number
  serverHead?: string | null
  serverVersion?: number
  error?: string
}

export async function status(root: string, name: string, given?: Credentials): Promise<SyncStatus> {
  const credentials = given ?? readCredentials()
  const local = history(root, name, 200)
  const base: SyncStatus = {
    paired: credentials !== undefined,
    baseUrl: credentials?.baseUrl,
    deviceId: credentials?.deviceId,
    localHead: local[0]?.sha,
    localCommits: local.length,
  }
  if (!credentials) return base

  const doc = readDoc(root, name)
  const result = await call<PullResponse>(
    credentials,
    `/api/blueprint/pull?blueprintId=${encodeURIComponent(doc.id)}`,
  )
  if (!result.ok) return { ...base, error: `server said ${result.status}` }
  const latest = result.body.commits.at(-1)
  return { ...base, serverHead: latest?.sha ?? null, serverVersion: latest?.version }
}

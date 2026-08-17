import { ALIASES, UPSTREAMS, type Upstream } from "./upstreams";

export type ResolvedTarget = { upstream: Upstream; model: string };

/** How many alias hops to follow before treating the table as broken. */
const MAX_ALIAS_DEPTH = 4;

/**
 * Follows an alias to a concrete model id.
 *
 * Returns null on a cycle rather than looping: an alias table is hand-edited, and `a → b → a` is
 * a plausible typo. A null becomes a 404, which tells the owner something is wrong with their
 * config; a hang would take the process with it.
 */
export function resolveAlias(requested: string, aliases: Readonly<Record<string, string>> = ALIASES): string | null {
  const seen = new Set<string>([requested]);
  let current = requested;
  for (let hop = 0; hop < MAX_ALIAS_DEPTH; hop += 1) {
    const next = aliases[current];
    if (next === undefined) return current;
    if (seen.has(next)) return null;
    seen.add(next);
    current = next;
  }
  return null;
}

/**
 * The upstreams to try, in order.
 *
 * An empty result means "no upstream claims this model", which is a 404 and never a 500. Exact
 * `models` membership beats a `prefixes` match, because a prefix is a catch-all and an exact
 * listing is a statement. Ties are broken by name so the chain is the same on every request —
 * a fallback order that varies is one that cannot be reasoned about from a log.
 *
 * Defaults are parameters so tests never touch the real routing table.
 */
export function resolveChain(
  requested: string,
  upstreams: readonly Upstream[] = UPSTREAMS,
  aliases: Readonly<Record<string, string>> = ALIASES,
): ResolvedTarget[] {
  const model = resolveAlias(requested, aliases);
  if (model === null) return [];

  const scored: { target: ResolvedTarget; exact: boolean }[] = [];
  for (const upstream of upstreams) {
    if (!upstream.enabled) continue;
    if (upstream.models.includes(model)) {
      scored.push({ target: { upstream, model }, exact: true });
      continue;
    }
    if (upstream.prefixes.some((prefix) => model.startsWith(prefix))) {
      scored.push({ target: { upstream, model }, exact: false });
    }
  }

  scored.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.target.upstream.priority !== b.target.upstream.priority) {
      return a.target.upstream.priority - b.target.upstream.priority;
    }
    return a.target.upstream.name.localeCompare(b.target.upstream.name);
  });

  return scored.map((entry) => entry.target);
}

export type CatalogEntry = { id: string; object: "model"; created: number; owned_by: string };

/**
 * A fixed timestamp, not `Date.now()`. This catalog is derived from a config file, so it changes
 * when the file changes and not once a second — a `created` that moves on every request makes the
 * response uncacheable and tells the client nothing true.
 */
const CREATED = 1_700_000_000;

/**
 * The `/v1/models` payload, synthesized from the routing table. Aliases are first-class ids,
 * because pinning an alias is the point of having one.
 *
 * `owned_by` is the upstream's slug and never its base URL or key name: this response goes to
 * every client that asks, and which vendor the owner pays is not something to leak by accident.
 */
export function catalog(
  upstreams: readonly Upstream[] = UPSTREAMS,
  aliases: Readonly<Record<string, string>> = ALIASES,
): CatalogEntry[] {
  const out = new Map<string, string>();
  for (const upstream of upstreams) {
    if (!upstream.enabled) continue;
    for (const model of upstream.models) if (!out.has(model)) out.set(model, upstream.name);
  }
  for (const alias of Object.keys(aliases)) {
    const resolved = resolveAlias(alias, aliases);
    // An alias to a model no enabled upstream serves would be a listing that 404s on first use.
    if (resolved === null || !out.has(resolved)) continue;
    if (!out.has(alias)) out.set(alias, out.get(resolved)!);
  }
  return [...out].map(([id, owner]) => ({ id, object: "model" as const, created: CREATED, owned_by: owner }));
}

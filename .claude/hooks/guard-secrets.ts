#!/usr/bin/env bun
/**
 * PreToolUse hook for Bash: refuses commands that name a secret file (AGENTS.md rule 1).
 * Permission deny rules can only match a command's prefix, so `head web/.env` slipped past
 * `Bash(cat *.env*)`; this looks at the whole command.
 *
 * ponytail: string match, not a shell parser. `sh -c "$(printf ...)"` or a script that opens
 * the file still gets through; gitleaks in CI and keeping secrets out of plain files are the
 * real controls. Upgrade path: tokenize the command (Polly tools/lib/guards.ts) if this leaks.
 */
const SECRET_PATHS = [
  /(^|[\s/=<])\.env(?!\.example)\b/, // .env, .env.local, web/.env — not .env.example
  /\/(secrets|credentials)\.json\b/, // ~/.config/jarvis/secrets.json, ~/.local/share/jarvis/credentials.json
  /\.pem\b/,
  /\bid_(rsa|ed25519|ecdsa)\b/,
  /\bkubectl\b.*\bsecrets?\b/,
]

const input = JSON.parse((await Bun.stdin.text()) || "{}") as { tool_input?: { command?: string } }
const command = input.tool_input?.command ?? ""
const hit = SECRET_PATHS.find((pattern) => pattern.test(command))
if (hit) {
  console.error(
    `Refused: this command names a secret file (${hit.source}). AGENTS.md rule 1: never read or print a secret — name the variable, not its value. web/.env.example is the reference.`,
  )
  process.exit(2)
}

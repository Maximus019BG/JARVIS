# Use cases

What JARVIS does for a user, one end-to-end flow per page: who starts it, every step across the
TUI, web, phone and Pi, and the business rules along the way (limits, scopes, states, timeouts),
each with its exact value and the file it comes from.

[`docs/modules/`](../modules/README.md) is organized by **code**: how one subsystem works inside.
This folder is organized by **use case**: one flow such as "draw with my hand on the Pi" crosses
four modules, and its page here puts them together. Use-case pages link to module docs for file
tables and internals instead of copying them.

## Rule: docs follow behaviour

If a change alters behaviour (a flow, limit, permission or state that a user or device sees),
update the matching page here **in the same commit** and bump its `Verified:` line. A new
user-facing flow gets a new page made from the template below, plus a row in the index.
A refactor that changes no behaviour does not need a use-case update. See AGENTS.md rule 10.

## Index

| Use case | Modules it spans |
|---|---|
| [Sign up and sign in](sign-up-and-sign-in.md) | [web/auth-and-accounts](../modules/web/auth-and-accounts/README.md), [web/email](../modules/web/email/README.md), [mobile](../modules/mobile/README.md) |
| [Pair a device](pair-a-device.md) | [web/devices-and-pairing](../modules/web/devices-and-pairing/README.md), [tui/cli](../modules/tui/cli/README.md) |
| [MCP access](mcp-access.md) | [web/mcp](../modules/web/mcp/README.md), [web/auth-and-accounts](../modules/web/auth-and-accounts/README.md) |
| [Hand gestures and drawing](hand-gestures-and-drawing.md) | [tui/pi-vision](../modules/tui/pi-vision/README.md), [web/vision](../modules/web/vision/README.md), [tui/ui](../modules/tui/ui/README.md), [`models/`](../../models/README.md) |
| [Teach and find items](teach-and-find-items.md) | [web/vision](../modules/web/vision/README.md), [tui/pi-vision](../modules/tui/pi-vision/README.md), [tui/tools](../modules/tui/tools/README.md) |
| [Voice](voice.md) | [tui/voice](../modules/tui/voice/README.md), [mobile](../modules/mobile/README.md) |
| [Install and setup](install-and-setup.md) | [tui/cli](../modules/tui/cli/README.md), [tui/config](../modules/tui/config/README.md), [tui/extensions](../modules/tui/extensions/README.md), [tui/engineering](../modules/tui/engineering/README.md), [web/frontend-shell](../modules/web/frontend-shell/README.md), [web/database](../modules/web/database/README.md), [`k8s/`](../../k8s/README.md) |
| [Agent turn and permissions](agent-turn-and-permissions.md) | [tui/agent](../modules/tui/agent/README.md), [tui/tools](../modules/tui/tools/README.md), [tui/ui](../modules/tui/ui/README.md) |
| [Remote approval and steering](remote-approval-and-steering.md) | [web/sessions-and-approvals](../modules/web/sessions-and-approvals/README.md), [mobile](../modules/mobile/README.md) |
| [Model calls and usage](model-calls-and-usage.md) | [web/gateway](../modules/web/gateway/README.md), [tui/agent](../modules/tui/agent/README.md) |
| [Code projects](code-projects.md) | [tui/code-projects](../modules/tui/code-projects/README.md), [web/code-projects](../modules/web/code-projects/README.md) |
| [Blueprints](blueprints.md) | [tui/blueprint-system](../modules/tui/blueprint-system/README.md), [web/blueprints](../modules/web/blueprints/README.md) |
| [Automations](automations.md) | [web/automations](../modules/web/automations/README.md), [web/mcp](../modules/web/mcp/README.md), [tui/cli](../modules/tui/cli/README.md) |

## Template

```markdown
# <Use case>

Modules: [web/vision](../modules/web/vision/README.md), … · Verified: <YYYY-MM-DD> @ <short sha>

## Who and why
Who starts this flow and what they get out of it, in 2–4 lines.

## Flow
Numbered steps across actors (user, TUI, web, phone, Pi), citing `path/file.ts` → `symbol`
only where it helps a reader find the rule.

## Business rules
Limits, permissions and scopes, states and transitions, timeouts. Exact values, each with the
file it comes from.

## When it fails
What the user sees for each failure (401, 503, expired ticket, …) and how they recover.

## Related
Other use cases and module docs.
```

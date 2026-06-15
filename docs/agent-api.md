# Agent API Guide

This file is the short contract for agents that drive lobsterfleet through the
API. The UI uses these same routes.

## Mental Model

| Thing | Meaning | Main route |
| --- | --- | --- |
| Card | Board work item with prompt, repo, lane, policy, run, and linked boxes | `/api/cards` |
| Box | Live interactive crabbox session, also called an interactive session | `/api/boxes` |
| Run | Scheduler attempt for a card | `/api/cards/:id/runs` |
| Lease link | Join record between a card and a box, run, or raw lease id | `/api/cards/:id/lease-links` |
| Attention | Box state that says the agent is waiting for human input | `/api/boxes` |
| Terminal | WebSocket bridge to the box tmux session | `/api/terminal/ws` |

Use cards to track intent. Use boxes to inspect and control live workspaces.
Use lease links to connect a live box to a board card.

## Ids

| Prefix | Object | Example |
| --- | --- | --- |
| `CY-` | Board card | `CY-101` |
| `IS-` | Interactive session, also called a box | `IS-101` |
| `BL-` | Board lease link | `BL-25EC7C427D63` |
| `CY-...-R...` | Run attempt for a card | `CY-101-R1` |
| `cbx_` | Broker lease id from lobsterbox | `cbx_f069...` |

The numeric part is just a local sequence. `CY-101-R2` means the second run
attempt for card `CY-101`.

## Auth

For local agent scripts, use the bootstrap token or an existing browser cookie.
Production users usually arrive through GitHub OAuth.

Login with the bootstrap token and save cookies:

```sh
curl -fsS -c cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{"token":"dev"}' \
  http://127.0.0.1:8099/api/login/token
```

Reuse the cookie jar:

```sh
curl -fsS -b cookies.txt http://127.0.0.1:8099/api/session
```

Role gates:

| Role | Can do |
| --- | --- |
| viewer | Read state, cards, boxes, logs, terminal view |
| maintainer | Create cards, create boxes, attach links, mutate work |
| owner | Admin policy and allowlist changes |

## Board Cards

List cards:

```sh
curl -fsS -b cookies.txt http://127.0.0.1:8099/api/cards
```

Read one card:

```sh
curl -fsS -b cookies.txt http://127.0.0.1:8099/api/cards/CY-101
```

Create a card:

```sh
curl -fsS -b cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{
    "repo": "octocat/hello-world",
    "title": "Fix login",
    "prompt": "Find and fix the failing login test",
    "source": "Prompt",
    "runtime": "auto",
    "policy": "open_pr"
  }' \
  http://127.0.0.1:8099/api/cards
```

Card fields:

| Field | Meaning |
| --- | --- |
| `id` | Board id like `CY-101` |
| `title` | Short title shown on the card |
| `prompt` | Full task prompt |
| `repo` | GitHub repo in `owner/name` form |
| `source` | `Prompt`, `Issue`, or `PR` |
| `runtime` | `auto`, `crabbox`, or `crabbox-gui` |
| `policy` | PR merge policy |
| `lane` | `Todo`, `Running`, `Human Review`, or `Done` |
| `owner` | User that created the card |
| `startedAt` | Unix ms timestamp when work started |
| `createdAt` | Unix ms timestamp when card was created |
| `logs` | Recent board events |
| `changes` | Changed file summary and patch if known |
| `run` | Active run attempt or `null` |
| `leaseLinks` | Attached boxes, runs, or leases |

Merge policies:

| Value | Meaning |
| --- | --- |
| `open_pr` | Open a PR |
| `merge_when_green` | Merge PR when checks are green |
| `fix_until_green_and_merge` | Fix PR until green, then merge |
| `open_draft_pr` | Open a draft PR |
| `fix_draft_pr_until_green` | Fix draft PR until green |
| `default` | Only accepted on create, resolves from repo workflow config |

Card actions:

```sh
curl -fsS -b cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{"action":"start"}' \
  http://127.0.0.1:8099/api/cards/CY-101/actions
```

| Action | Effect |
| --- | --- |
| `start` | Move to Running and create or heartbeat a run |
| `pulse` | Heartbeat an active run |
| `advance` | Move to the next board lane |
| `watch` | Add a watch event |
| `takeover` | Mark operator takeover on an active run |
| `stall` | Mark the active run stalled |
| `attach` | Read-only compatibility action |

Delete a card:

```sh
curl -fsS -X DELETE -b cookies.txt \
  -H "origin: http://127.0.0.1:8099" \
  http://127.0.0.1:8099/api/cards/CY-101
```

## Boxes

`/api/boxes` is the box-named alias for the interactive session inventory.
`/api/interactive-sessions` returns the same objects under `sessions`.

List all boxes:

```sh
curl -fsS -b cookies.txt http://127.0.0.1:8099/api/boxes
```

Read one box:

```sh
curl -fsS -b cookies.txt \
  http://127.0.0.1:8099/api/interactive-sessions/IS-101
```

Create a box:

```sh
curl -fsS -b cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{
    "repo": "octocat/hello-world",
    "branch": "main",
    "runtime": "crabbox",
    "size": "fast",
    "region": "local",
    "machine": "docker",
    "command": "codex --yolo",
    "prompt": "Fix the failing tests"
  }' \
  http://127.0.0.1:8099/api/interactive-sessions
```

Create a box and attach it to a card in the same call:

```sh
curl -fsS -b cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{
    "repo": "octocat/hello-world",
    "branch": "main",
    "runtime": "crabbox",
    "prompt": "Work this card",
    "cardId": "CY-101"
  }' \
  http://127.0.0.1:8099/api/interactive-sessions
```

Codex defaults:

| Source | Where it lands in the box |
| --- | --- |
| `defaults/codex/AGENTS.md` | `~/.codex/AGENTS.md` |
| `defaults/codex/config.toml` | `~/.codex/config.toml` |

The New Crabbox UI loads those project files. The API can override them per box
with `agentsMd` and `configToml`. Blank values mean the box gets no file.

Create body fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `repo` | yes | GitHub repo in `owner/name` form, must be allowlisted |
| `branch` | no | Branch to clone, defaults to `main` |
| `runtime` | no | `crabbox` or `crabbox-gui`, defaults to `crabbox` |
| `size` | no | Broker size class, defaults to install config |
| `region` | no | Broker region, defaults to install config or `local` |
| `machine` | no | Broker machine type, defaults to install config or `docker` |
| `aptUpgrade` | no | Run full apt upgrade during boot |
| `command` | no | Command to run, defaults to `codex --yolo` |
| `prompt` | no | Initial task prompt |
| `configToml` | no | Per-box `~/.codex/config.toml` |
| `agentsMd` | no | Per-box `~/.codex/AGENTS.md` |
| `cardId` | no | Attach the new box to a board card |
| `parentSessionId` | no | Link this box as a child session |
| `rootSessionId` | no | Override root session lineage |
| `purpose` | no | Human purpose text |
| `summary` | no | Short summary text |

Box fields:

| Field | Meaning |
| --- | --- |
| `id` | Interactive session id like `IS-101` |
| `parentSessionId` | Parent session id, or `null` |
| `rootSessionId` | Root session id |
| `repo` | GitHub repo |
| `branch` | Branch inside the box |
| `runtime` | `crabbox` or `crabbox-gui` |
| `size` | Requested or defaulted size class |
| `region` | Requested or defaulted region |
| `machine` | Requested or defaulted machine |
| `aptUpgrade` | Whether boot runs apt upgrade |
| `command` | Started command |
| `prompt` | Initial task prompt |
| `purpose` | Purpose text used for display |
| `summary` | Short display summary |
| `owner` | Box owner |
| `createdBy` | Creator actor |
| `status` | Current lifecycle status |
| `leaseId` | Broker lease id, if leased |
| `attachUrl` | SSH or bridge target |
| `vncUrl` | Desktop URL for GUI boxes |
| `lastEvent` | Last session event text |
| `attentionState` | Empty string or `needs_input` |
| `attentionReason` | Why the agent appears blocked |
| `attentionAt` | Unix ms timestamp for attention |
| `createdAt` | Unix ms timestamp |
| `updatedAt` | Unix ms timestamp |
| `lastSeenAt` | Last terminal attach timestamp |
| `stoppedAt` | Stop timestamp or `null` |
| `shareMode` | `private` or `link_read` |
| `shareTokenPreview` | First chars of share token |
| `controlRequestedBy` | Actor waiting for control |
| `controlRequestedAt` | Unix ms timestamp |
| `controller` | Actor with delegated control |
| `controlGrantedAt` | Unix ms timestamp |
| `controlExpiresAt` | Unix ms timestamp |
| `multiplayerMode` | Whether attributed terminal input is enabled |
| `canControl` | Caller can type into the box |
| `canManage` | Caller can stop and manage sharing |
| `canChangeMultiplayer` | Caller can toggle multiplayer |
| `canRequestControl` | Caller can request control |
| `sharedReadOnly` | Caller is using read-only share access |
| `logs` | Recent session event strings |
| `logArchive` | Archive metadata when logs are archived |
| `boardLinks` | Cards linked to this box |

Status values:

| Status | Meaning |
| --- | --- |
| `provisioning` | Lease request is in progress |
| `pending_adapter` | Runtime adapter is missing or not ready |
| `ready` | Box is ready to attach |
| `attached` | Terminal has attached |
| `detached` | Terminal was detached |
| `stopped` | Box was stopped and released |
| `expired` | Box expired |
| `failed` | Provision or runtime failed |

Box actions:

```sh
curl -fsS -b cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{"action":"stop"}' \
  http://127.0.0.1:8099/api/interactive-sessions/IS-101/actions
```

| Action | Effect |
| --- | --- |
| `attach` | Mark attach and update last seen |
| `share_link` | Enable read-only share link |
| `disable_share` | Disable share and delegated control |
| `enable_multiplayer` | Enable attributed terminal input |
| `disable_multiplayer` | Disable attributed terminal input |
| `request_control` | Ask owner for terminal control |
| `approve_control` | Grant pending control request |
| `deny_control` | Deny pending control request |
| `revoke_control` | Remove delegated control |
| `stop` | Release lease, close links, archive logs |

## Board Lease Links

Attach an existing box to a card:

```sh
curl -fsS -b cookies.txt \
  -H "content-type: application/json" \
  -H "origin: http://127.0.0.1:8099" \
  -d '{
    "sessionId": "IS-101",
    "role": "primary",
    "source": "manual_attach"
  }' \
  http://127.0.0.1:8099/api/cards/CY-101/lease-links
```

Attach by run id or raw lease id:

```json
{ "runId": "CY-101-R1", "role": "review", "source": "card_run" }
```

```json
{ "leaseId": "cbx_abc123", "role": "manual", "source": "manual_attach" }
```

Link fields:

| Field | Meaning |
| --- | --- |
| `id` | Link id like `BL-...` |
| `cardId` | Card id |
| `cardTitle` | Card title |
| `sessionId` | Box id, if linked to a box |
| `runId` | Run id, if linked to a run |
| `leaseId` | Broker lease id |
| `role` | `primary`, `helper`, `review`, or `manual` |
| `source` | `card_run`, `manual_attach`, or `new_crabbox` |
| `status` | `attached`, `detached`, or `released` |
| `attachedBy` | Actor that attached it |
| `attachedAt` | Unix ms timestamp |
| `detachedAt` | Unix ms timestamp or `null` |
| `session` | Box summary when `sessionId` points to a box |

Detach a link:

```sh
curl -fsS -X DELETE -b cookies.txt \
  -H "origin: http://127.0.0.1:8099" \
  http://127.0.0.1:8099/api/cards/CY-101/lease-links/BL-ABC123
```

## Waiting For Input

The server watches terminal output. When it detects a Codex prompt or user input
prompt, the box appears in `/api/boxes` with:

```json
{
  "attentionState": "needs_input",
  "attentionReason": "agent is asking for input",
  "attentionAt": 1781480000000
}
```

Poll waiting boxes:

```sh
curl -fsS -b cookies.txt http://127.0.0.1:8099/api/boxes
```

Then inspect session logs:

```sh
curl -fsS -b cookies.txt \
  http://127.0.0.1:8099/api/interactive-sessions/IS-101/logs
```

The logs route returns:

| Field | Meaning |
| --- | --- |
| `session` | Full box object |
| `events` | Recent session events |
| `archive` | Archive metadata |
| `eventCount` | Total event count |
| `truncated` | Whether the returned events are capped |

For the live terminal screen, subscribe to `/api/terminal/ws` and request a
snapshot. To answer the prompt, send an `Input` frame. Add `\n` when you want to
press Enter.

There is no REST input endpoint yet. This route does not exist:

```text
POST /api/interactive-sessions/:id/input
```

Use the terminal WebSocket for input.

## Terminal WebSocket

Endpoint:

```text
GET /api/terminal/ws
```

The socket uses binary frames. All integers are little endian.

Frame layout:

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 2 | Magic `0x5943` |
| 2 | 1 | Version `1` |
| 3 | 1 | Message type |
| 4 | 4 | Session id byte length |
| 8 | n | UTF-8 session id |
| 8 + n | 4 | Payload byte length |
| 12 + n | m | Payload bytes |

Message types:

| Type | Value | Direction | Payload |
| --- | --- | --- | --- |
| `Hello` | 1 | client to server | empty |
| `Welcome` | 2 | server to client | JSON |
| `Subscribe` | 10 | client to server | subscribe payload |
| `Unsubscribe` | 11 | client to server | empty |
| `Output` | 20 | server to client | terminal bytes |
| `Snapshot` | 21 | server to client | terminal bytes |
| `Event` | 22 | server to client | JSON |
| `Error` | 23 | server to client | JSON |
| `Input` | 30 | client to server | terminal input bytes |
| `Key` | 31 | client to server | terminal input bytes |
| `Resize` | 32 | client to server | resize payload |
| `Stop` | 33 | client to server | empty |
| `ControlRequest` | 50 | client to server | JSON |
| `ControlDecision` | 51 | client to server | JSON |
| `ControlGranted` | 52 | server to client | JSON |
| `ControlRevoked` | 53 | server to client | JSON |
| `Ping` | 60 | either | bytes |
| `Pong` | 61 | either | bytes |

Subscribe flags:

| Flag | Value | Meaning |
| --- | --- | --- |
| `Output` | 1 | Stream live output |
| `Snapshot` | 2 | Send initial screen snapshot |
| `Events` | 4 | Stream control events |

Subscribe payload:

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | Flags |
| 4 | 4 | Snapshot min interval ms |
| 8 | 4 | Snapshot max interval ms |
| 12 | 4 | Optional cols |
| 16 | 4 | Optional rows |

Resize payload:

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | Columns |
| 4 | 4 | Rows |

The first `Event` after subscribe has:

```json
{ "type": "subscribed", "canInput": true }
```

If `canInput` is false, input frames are rejected with `ControlRevoked`.
Use the box action routes to request or approve control.

Minimal Node script to send one answer:

```js
import WebSocket from "ws"
import { readFileSync } from "node:fs"

const url = "ws://127.0.0.1:8099/api/terminal/ws"
const sessionId = process.argv[2]
const text = process.argv[3] ?? ""
const sessionCookie = readFileSync("cookies.txt", "utf8")
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"))
  .find((parts) => parts[5] === "crabbox_session")

if (!sessionCookie) {
  throw new Error("crabbox_session cookie missing")
}

const cookie = `crabbox_session=${sessionCookie[6]}`

const enc = new TextEncoder()
const dec = new TextDecoder()

function frame(type, id = "", payload = new Uint8Array()) {
  const idBytes = enc.encode(id)
  const out = new Uint8Array(12 + idBytes.length + payload.length)
  const view = new DataView(out.buffer)
  let offset = 0
  view.setUint16(offset, 0x5943, true)
  offset += 2
  view.setUint8(offset, 1)
  offset += 1
  view.setUint8(offset, type)
  offset += 1
  view.setUint32(offset, idBytes.length, true)
  offset += 4
  out.set(idBytes, offset)
  offset += idBytes.length
  view.setUint32(offset, payload.length, true)
  offset += 4
  out.set(payload, offset)
  return out
}

function subscribePayload() {
  const out = new Uint8Array(20)
  const view = new DataView(out.buffer)
  view.setUint32(0, 7, true)
  view.setUint32(12, 120, true)
  view.setUint32(16, 34, true)
  return out
}

function readFrame(data) {
  const bytes = new Uint8Array(data)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 4
  const idLength = view.getUint32(offset, true)
  offset += 4
  const id = dec.decode(bytes.subarray(offset, offset + idLength))
  offset += idLength
  const payloadLength = view.getUint32(offset, true)
  offset += 4
  return {
    type: view.getUint8(3),
    id,
    payload: bytes.subarray(offset, offset + payloadLength)
  }
}

const ws = new WebSocket(url, { headers: { Cookie: cookie } })

ws.on("open", () => {
  ws.send(frame(1))
  ws.send(frame(10, sessionId, subscribePayload()))
})

ws.on("message", (data) => {
  const msg = readFrame(data)
  if (msg.type !== 22) return
  const event = JSON.parse(dec.decode(msg.payload))
  if (event.type !== "subscribed") return
  if (!event.canInput) {
    throw new Error("terminal control has not been granted")
  }
  ws.send(frame(30, sessionId, enc.encode(`${text}\n`)))
  setTimeout(() => ws.close(), 250)
})
```

Run it:

```sh
node send-input.mjs IS-101 "Yes, continue"
```

Input that contains text or Enter clears the `needs_input` attention state.

## Common Agent Loops

Pick up a board card:

1. `GET /api/cards`
2. Choose a card in `Todo` or `Human Review`
3. `POST /api/interactive-sessions` with `cardId`
4. Poll `GET /api/boxes`
5. If `attentionState` is `needs_input`, inspect logs and terminal snapshot
6. Send an `Input` frame over `/api/terminal/ws`
7. Stop the box or advance the card when done

Attach an existing box to a card:

1. `GET /api/cards`
2. `GET /api/boxes`
3. `POST /api/cards/:id/lease-links` with `sessionId`
4. Read card detail to verify `leaseLinks`

Audit active work:

1. `GET /api/boxes`
2. Group by `status`, `attentionState`, `repo`, `owner`, and `machine`
3. For linked work, inspect `boardLinks`
4. For terminal context, use `/api/interactive-sessions/:id/logs`
5. For live screen context, use `/api/terminal/ws` snapshot

## Sharp Edges

- The box input API is WebSocket only today.
- `GET /api/boxes` and `GET /api/interactive-sessions` return the same data with different top-level keys.
- `start` on a card queues or heartbeats a run. It does not guarantee a new live box unless a runtime path provisions one.
- To create a live box for a card right away, call `POST /api/interactive-sessions` with `cardId`.
- `repo` must be allowlisted before card or box creation.
- Browser-like requests need a same-origin `Origin` header on write calls.
- GitHub OAuth users need connected GitHub credentials for PR-capable session create.
- Read-only share links can view terminals but cannot send input.
- Delegated control expires and can be revoked.

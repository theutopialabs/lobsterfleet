# lobsterfleet — build blueprint

Self-hostable lobsterfleet. Same mission control, runs in a Proxmox LXC, brand-new
premium UI, full feature parity, agent-controllable over the API.

Source of truth for behavior: the original Worker at `../crabfleet` (read it).
This doc says what changes and how the pieces fit.

## Architecture

```
        ┌──────────────────────── LXC (single Node process) ────────────────────────┐
        │  web/dist (static) ──served by──▶ server (Node http + ws)                  │
        │                                     │                                      │
        │   /api/*  ── ported lobsterfleet handler ── node:sqlite (Kysely)              │
        │   /api/terminal/ws ── ws hub ── ssh2 ──▶ leased crabbox (data plane)       │
        │                          │                                                 │
        └──────────────────────────┼─────────────────────────────────────────────────┘
                                    ▼
                       crabbox broker  https://broker.theutopialabs.com  (lease control plane)
                                    ▼  provisions
                              Hetzner box (the crabbox)
```

- One process serves the SPA, the REST/WS API, and bridges terminals over SSH.
- No Cloudflare anything. No external services required beyond the broker + GitHub.
- The agent babysits the fleet by calling the same `/api/*` endpoints.

## Backend port (server/)

Ported source lives in `server/src/core/` (copied from `../crabfleet/src`). The
handler is written against web-standard `Request`/`Response`/`WebCrypto`, so most
of it runs on Node 24 unchanged. Swap only the Cloudflare seams:

| Seam | Cloudflare today | Replace with | Where |
| --- | --- | --- | --- |
| Entry | `export default { fetch(req, env) }` | Node `http` server + adapter (Node req → web `Request`, web `Response` → Node res) in `server/src/index.ts` | core/index.ts:~1111 |
| DB | custom `D1Dialect` over `env.DB` | `node:sqlite` Kysely dialect in `server/src/db.ts` (done) | core/index.ts:~742, `database()` ~816 |
| Batch | `env.DB.batch()` | wrap queries in one transaction (Kysely `.transaction()`) | core/index.ts `executeBatch` ~820 |
| WebSocket | `new WebSocketPair()` + `Response{webSocket}` | `ws` `WebSocketServer.handleUpgrade`; reuse the binary frame protocol unchanged | core/index.ts:~3089 |
| Durable Object | `SessionControlDO` (credential policy + checkpoints) | module singleton backed by a sqlite table (survives restart) | core/index.ts:~974 |
| Sandbox | `@cloudflare/sandbox` `getSandbox().terminal()/.checkpoint()` | **drop the container runtime**; provision via broker lease + SSH PTY (`ssh2`). Keep the provision/runtime-descriptor abstraction, implement the crabbox path | core/index.ts:~3274,4185,4605 |
| R2 | `env.SESSION_LOGS` / `env.BACKUP_BUCKET` | local disk under `data/archives/` (small fs module) | core/index.ts:~6491,6684 |
| Env | `env.X` bindings | `process.env` assembled into a `RuntimeEnv`-shaped object once at boot | core/index.ts:~58 |
| Static `/`, SPA | `APP_HTML` from `generated.ts` | serve `web/dist` (new UI); stub `generated.ts` so imports resolve | core/index.ts:~1119 |
| Cron | `reconcileStalledRuns` called in `/api/state` | keep on-demand + add a `setInterval` | core/index.ts:~6960 |

Crypto (`crypto.subtle` AES-GCM, SHA-256, `randomUUID`) is global in Node — no
change. Migrations: run all 19 `server/migrations/*.sql` in order at boot against
the sqlite file (simple runner: track applied in a `_migrations` table). Note the
two `0013_*` files — apply both.

**Provisioning the crabbox (the one real rewrite).** Use the broker contract:
`POST {CRABBOX_COORDINATOR_URL}/v1/leases` with `Authorization: Bearer` + optional
`X-Crabbox-Owner`; poll `GET /v1/leases/{id}` until `state==active` and `host` set;
`POST /v1/leases/{id}/heartbeat` to keep alive; `POST /v1/leases/{id}/release`
`{delete:true}` to tear down. Then SSH (`ssh2`) to `lease.host:lease.sshPort` as
`lease.sshUser` with an app-managed key (public key goes in the lease request).
Terminal attach = an `ssh2` shell channel (PTY) bridged to the `ws` terminal hub
using the existing frame protocol. VNC = the broker's desktop URL when `desktop`.

Single-user/local scope: keep auth/roles code working but the operator is owner by
default. GitHub OAuth optional; a GitHub PAT (env) powers issue/PR lookup.

## Frontend (web/) — premium UI, full parity

Stack: React + Vite + TS + Tailwind v4 + Framer Motion. Design tokens already in
`web/src/index.css` (`--color-bg #06070a`, accent `#6d5efc`, accent-2 `#28c8ff`,
glass panels, `.aurora` ambient glow, `.brand-gradient`). Aesthetic: NVIDIA /
Apple-keynote — deep space, hairline borders, generous spacing, restrained motion
(fade/slide on mount, `layoutId` for shared elements), tabular numerics.

Views to reach parity with lobsterfleet (see `../crabfleet/src/app/main.jsx` for
behavior, NOT styling — we redesign):

1. **Fleet** — boxes grouped by operator; status strip (running/boxes/operators);
   per-box tile (repo/slug, state pill, branch, runtime, ttl/idle, last event,
   ssh hint) with Attach / VNC / Logs / Release; "New crabbox" lease sheet.
2. **Board** — Kanban lanes Todo / Running / Human Review / Done; card tiles
   (title, prompt, repo, runtime, merge policy, run chip, diff summary); filters
   all/mine/live; search with `#123` GitHub issue/PR lookup → create card; New card
   sheet (source prompt/issue/PR, repo, runtime, merge policy).
3. **Sessions** — terminal grid (xterm.js over the `/api/terminal/ws` hub),
   resizable/focusable tiles, per-tile actions (vnc, logs, share, take over),
   provisioning + replay states.
4. **Run drawer** — terminal output + diff view + capabilities + actions (watch,
   take over, mark stalled).
5. **Admin** — allowlists, repos, policy (cap/merge/retention), workflows
   (CRABBOX.md). (Local scope: thin, but present.)
6. **Login** — GitHub OAuth + token; only when not already an owner locally.

Realtime: poll `/api/state` (15s) + the terminal websocket. Use xterm.js for
terminals (the new UI does not reuse Ghostty WASM).

## Packaging (deploy/)

- `Dockerfile` (multi-stage: build web + bundle server, run on `node:24-slim`).
- `deploy/lxc-setup.sh` — provision a Debian/Ubuntu Proxmox LXC: install Node,
  pull/build, install the systemd unit, create `data/` + `.env`.
- `deploy/lobsterfleet.service` — systemd unit.
- `.env.example` — broker URL/token, owner, GitHub PAT/OAuth, paths, port.
- `README.md` — self-host quickstart + the agent/API surface.

## Definition of done

`pnpm build` produces a static `web/dist` + bundled server; the server boots in an
LXC, applies migrations, serves the premium UI, leases a crabbox through the
broker, attaches a live SSH terminal, and exposes the full `/api/*` surface for an
agent to drive.

# lobsterfleet

Self-hostable lobsterfleet. The same fleet mission control, but it runs as one Node
process you host yourself, typically in a Proxmox LXC. Brand-new premium UI, full
feature parity, and fully drivable by an agent over the API.

It serves the web app, the REST/WebSocket API, and bridges live terminals to
remote dev boxes over SSH. No Cloudflare, no extra services. The only outside
dependencies are the lobsterbox broker (to lease boxes) and GitHub.

## What it does

- Leases ephemeral dev boxes (crabboxes) through a broker, then SSHes into them.
- Runs a Kanban board of agent runs against your repos.
- Gives you live, multiplexed terminals (xterm.js) into each box.
- Local dev can use a loopback owner login. Production should use GitHub OAuth
  or a break-glass bootstrap token.

## Architecture

```
        +---------------------- LXC (single Node process) ----------------------+
        |  web/dist (static) --served by--> server (Node http + ws)            |
        |                                     |                                 |
        |   /api/*  -- lobsterfleet handler -- node:sqlite (Kysely)               |
        |   /api/terminal/ws -- ws hub -- ssh2 --> leased crabbox (data plane) |
        |                          |                                            |
        +--------------------------+--------------------------------------------+
                                   v
                  lobsterbox broker  (lease control plane)
                                   v  provisions
                        Docker or Hetzner runner
```

One process serves the SPA, the API, and the terminal bridge. The broker hands out
boxes. The agent babysits the fleet by calling the same `/api/*` endpoints.

## Requirements

- Node 24+ (the server uses the built-in `node:sqlite`, so no native build deps).
- A lobsterbox broker URL + token.
- An SSH keypair so the server can reach leased boxes.
- Codex installed and authed on this host. The server copies the host's codex
  credential onto every leased box, so each crabbox comes up codex-ready.
- A GitHub token (for issue/PR lookup). GitHub OAuth is optional.

### Codex auth

The host (your LXC or container) is the single source of codex credentials.
At provision time the server reads the credential, ships it to the new box over
SSH, and installs the codex CLI there if the image lacks it.

Lookup order:

1. `LOBSTERFLEET_CODEX_AUTH_PATH` -- explicit path to an `auth.json`.
2. `$CODEX_HOME/auth.json`.
3. `~/.codex/auth.json` of the user running the server (in the LXC that is the
   `lobsterfleet` user, whose home is `/opt/lobsterfleet`).
4. `OPENAI_API_KEY` from the env -- synthesized into an api-key `auth.json`.

For an LXC the simplest setup is copying the file from a machine where you ran
`codex login`:

```sh
mkdir -p /opt/lobsterfleet/.codex
scp ~/.codex/auth.json root@<lxc>:/opt/lobsterfleet/.codex/auth.json
chown -R lobsterfleet:lobsterfleet /opt/lobsterfleet/.codex
chmod 600 /opt/lobsterfleet/.codex/auth.json
```

ChatGPT-plan tokens refresh over time, so re-copy the file occasionally, or use
`OPENAI_API_KEY` for a set-and-forget headless install. The Admin preflight
panel shows which source is active. Set `LOBSTERFLEET_CODEX_BOOTSTRAP=0` to turn
the bootstrap off entirely.

### Crabbox Codex defaults

Default Codex files for new crabboxes live in the repo:

- `defaults/codex/AGENTS.md`
- `defaults/codex/config.toml`

The New Crabbox sheet loads both files and lets you edit them for one lease. If
either file is blank, that crabbox gets no file. If either file is missing,
lobsterfleet falls back to the host Codex file.

## Configure

Copy the example env and fill it in. Every var is documented in `.env.example`.

```sh
cp .env.example .env
```

The ones that matter to get going:

- `LOBSTERBOX_URL` + `LOBSTERBOX_TOKEN` -- the broker and its bearer token.
- `LOBSTERBOX_OWNER` -- optional owner tag for broker grouping.
- `LOBSTERFLEET_PUBLIC_URL` -- the URL users and agents use to reach this app.
- `LOBSTERBOX_SSH_PUBLIC_KEY` -- public half of an app-managed key. Make one:
  ```sh
  ssh-keygen -t ed25519 -f data/crabbox_key -N ""
  cat data/crabbox_key.pub   # paste into .env
  ```
- `CRABBOX_TOKEN_ENCRYPTION_KEY` -- 32 random bytes, base64: `openssl rand -base64 32`.
- `GITHUB_TOKEN` -- a PAT for issue/PR lookup and repo reads.
- `GITHUB_ORG` -- optional GitHub org gate for OAuth users. Leave it blank to rely on the allowlist only.
- `CRABBOX_BOOTSTRAP_TOKEN` -- break-glass owner login. Keep it secret and prefer OAuth for daily use.
- `LOBSTERFLEET_ENABLE_DEV_IDENTITY` -- optional local dev override. Leave it off in production.

## Install

Two paths. Pick one.

### A. Bare LXC (the common Proxmox pattern)

No Docker. Node runs straight in the container under systemd.

1. Create an unprivileged Debian 12 LXC on the Proxmox host. The exact `pct create`
   commands are in the comment block at the top of `deploy/lxc-setup.sh`
   (2 cores / 2GB / 8GB disk is plenty).
2. Inside the container:
   ```sh
   apt-get update && apt-get install -y git
   git clone <your-repo-url> /opt/lobsterfleet
   bash /opt/lobsterfleet/deploy/lxc-setup.sh
   ```
   The script installs Node 24, builds the app, creates the `lobsterfleet` user,
   sets up `data/` and `.env`, and installs + starts the systemd service.
3. Edit the config, then restart:
   ```sh
   nano /opt/lobsterfleet/.env
   systemctl restart lobsterfleet
   ```
4. Open `http://<lxc-ip>:8088`. Logs: `journalctl -u lobsterfleet -f`.

Re-running `lxc-setup.sh` after a `git pull` rebuilds and redeploys. It is idempotent.

### B. Docker

```sh
cp .env.example .env   # then fill it in
docker compose -f deploy/docker-compose.yml up -d --build
```

Open `http://localhost:8088`. The sqlite db and session archives live in `./data`.

The image is multi-stage: stage one builds the web bundle and bundles the server,
the final `node:24-slim` stage ships just the server bundle, its prod deps
(ssh2 / ws / kysely), the migrations, and the web build. See `deploy/Dockerfile`.

## Agent / API access

The whole fleet is drivable over the `/api/*` surface, the same endpoints the UI
uses. An agent can poll `/api/state`, create board cards, lease boxes, and attach
to terminals over `/api/terminal/ws` without touching the browser. The UI is just
one client. Point your agent at `http://<host>:8088/api` and it can run the fleet.

For the full agent contract, including board cards, box creation, waiting for
input, and terminal WebSocket frames, read [`docs/agent-api.md`](docs/agent-api.md).

## Data + backups

Everything that needs to persist lives under `data/`:

- `data/lobsterfleet.db` -- the sqlite database (`DATABASE_PATH`).
- `data/archives/` -- session log archives (`SESSION_ARCHIVE_DIR`).

Back up the `data/` dir and you have backed up the whole instance.

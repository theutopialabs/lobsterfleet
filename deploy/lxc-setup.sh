#!/usr/bin/env bash
#
# lobsterfleet bare-LXC setup. Run this INSIDE a fresh Debian 12 / Ubuntu 24.04
# Proxmox LXC. It installs Node 24, builds the app, and wires up a systemd service.
# No Docker. Idempotent: safe to re-run after a git pull to redeploy.
#
# -----------------------------------------------------------------------------
# Step 0: create the LXC from the Proxmox host (run these on the host, not here)
# -----------------------------------------------------------------------------
# Grab a Debian 12 template if you don't have one:
#   pveam update
#   pveam available | grep debian-12
#   pveam download local debian-12-standard_12.7-1_amd64.tar.zst
#
# Create an unprivileged container (2 cores / 2GB RAM / 8GB disk). Pick a free CTID
# (e.g. 200) and your storage/bridge names:
#   pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
#     --hostname lobsterfleet \
#     --unprivileged 1 \
#     --cores 2 --memory 2048 --swap 512 \
#     --rootfs local-lvm:8 \
#     --net0 name=eth0,bridge=vmbr0,ip=dhcp \
#     --features nesting=1 \
#     --onboot 1
#   pct start 200
#   pct enter 200
#
# Then inside the container:
#   apt-get update && apt-get install -y git
#   git clone <your-repo-url> /opt/lobsterfleet
#   bash /opt/lobsterfleet/deploy/lxc-setup.sh
# -----------------------------------------------------------------------------

set -euo pipefail

APP_DIR="/opt/lobsterfleet"
APP_USER="lobsterfleet"
NODE_MAJOR="24"
SERVICE_SRC="${APP_DIR}/deploy/lobsterfleet.service"
SERVICE_DST="/etc/systemd/system/lobsterfleet.service"

log() { echo -e "\n==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (inside the LXC)." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
log "Installing base packages"
# -----------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg git

# -----------------------------------------------------------------------------
log "Installing Node ${NODE_MAJOR} (NodeSource)"
# -----------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "${NODE_MAJOR}" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "Node $(node -v) already present, skipping."
fi

# -----------------------------------------------------------------------------
log "Enabling pnpm via corepack"
# -----------------------------------------------------------------------------
corepack enable
# Pin/activate the pnpm version declared in package.json.
corepack prepare --activate || true

# -----------------------------------------------------------------------------
log "Checking repo at ${APP_DIR}"
# -----------------------------------------------------------------------------
if [ ! -f "${APP_DIR}/package.json" ]; then
  echo "No repo found at ${APP_DIR}." >&2
  echo "Clone it first:  git clone <your-repo-url> ${APP_DIR}" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
log "Installing deps and building (web/dist + server/dist)"
# -----------------------------------------------------------------------------
cd "${APP_DIR}"
pnpm install --frozen-lockfile
pnpm build

# -----------------------------------------------------------------------------
log "Creating ${APP_USER} system user"
# -----------------------------------------------------------------------------
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
else
  echo "User ${APP_USER} already exists, skipping."
fi

# -----------------------------------------------------------------------------
log "Setting up data dir and .env"
# -----------------------------------------------------------------------------
mkdir -p "${APP_DIR}/data"
if [ ! -f "${APP_DIR}/.env" ]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  echo "Created ${APP_DIR}/.env from the example. EDIT IT before the service is useful."
else
  echo ".env already present, leaving it alone."
fi

# lobsterfleet owns its dir so it can write data/ and read .env.
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 600 "${APP_DIR}/.env"

# -----------------------------------------------------------------------------
log "Installing systemd unit"
# -----------------------------------------------------------------------------
cp "${SERVICE_SRC}" "${SERVICE_DST}"
systemctl daemon-reload
systemctl enable lobsterfleet
systemctl restart lobsterfleet

# -----------------------------------------------------------------------------
log "Checking codex auth"
# -----------------------------------------------------------------------------
# Leased boxes get this host's codex credential. Without it codex sessions on
# new crabboxes will not be authed (the Admin preflight panel flags this too).
if [ -f "${APP_DIR}/.codex/auth.json" ]; then
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/.codex"
  chmod 600 "${APP_DIR}/.codex/auth.json"
  echo "Found ${APP_DIR}/.codex/auth.json."
elif grep -q '^OPENAI_API_KEY=.\+' "${APP_DIR}/.env" 2>/dev/null; then
  echo "Using OPENAI_API_KEY from .env for codex on leased boxes."
else
  echo "No codex auth yet. Copy it from a machine where you ran 'codex login':"
  echo "  mkdir -p ${APP_DIR}/.codex"
  echo "  scp ~/.codex/auth.json root@<this-lxc>:${APP_DIR}/.codex/auth.json"
  echo "  chown -R ${APP_USER}:${APP_USER} ${APP_DIR}/.codex && chmod 600 ${APP_DIR}/.codex/auth.json"
  echo "Or set OPENAI_API_KEY in ${APP_DIR}/.env."
fi

# -----------------------------------------------------------------------------
log "Done"
# -----------------------------------------------------------------------------
echo "lobsterfleet is enabled and (re)started."
echo "  Edit config:   ${APP_DIR}/.env   (then: systemctl restart lobsterfleet)"
echo "  Logs:          journalctl -u lobsterfleet -f"
echo "  Status:        systemctl status lobsterfleet"
echo "  App:           http://<this-lxc-ip>:8088"

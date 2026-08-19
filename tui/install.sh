#!/bin/sh
# Builds jarvis and installs it on PATH. Works the same on macOS and Linux.
#
#   ./install.sh                       -> ~/.local/bin/jarvis
#   ./install.sh --prefix /usr/local/bin
#   ./install.sh --pi                  also install the Raspberry Pi projector units
#   ./install.sh --service [dir]       run `jarvis work` on boot (no desktop needed)
#   ./install.sh --uninstall           remove the binary, keep config and data
#   ./install.sh --uninstall --purge   also remove config, sessions and blueprints
#   ./uninstall.sh                     shorthand for --uninstall
#
#   --cloud <url>                      which JARVIS to pair with, seeded into the config
#   -y, --yes                          answer every prompt with yes
#
# Also runnable straight from a JARVIS deployment, which is what the web app's Devices tab
# hands you. Piped like that there is no checkout to build from, so it clones one:
#
#   curl -fsSL https://jarvis.example/install.sh | sh
#
# The binary is compiled here rather than downloaded, because bun embeds the host
# platform's libopentui into it — a Linux binary has to be built on Linux.
set -eu

PREFIX="${JARVIS_PREFIX:-$HOME/.local/bin}"
UNINSTALL=0
PI=0
YES=0
SERVICE=0
SERVICE_DIR=""
# Served copies get this replaced with the deployment's own origin, so the pairing wizard
# opens with the address already filled in. Empty for a plain checkout.
CLOUD_URL="${JARVIS_CLOUD_URL:-}"
# `$0` is not a path when the script arrives on stdin through a pipe, so this can land
# anywhere; `need_repo` below is what notices and clones.
REPO=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || REPO=""
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CONFIG_DIR="$CONFIG_HOME/jarvis"



while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      [ $# -ge 2 ] || { echo "install.sh: --prefix needs a directory" >&2; exit 2; }
      PREFIX="$2"
      shift 2
      ;;
    --prefix=*) PREFIX="${1#--prefix=}"; shift ;;
    --pi) PI=1; shift ;;
    --service)
      SERVICE=1
      # Optional directory argument, but not one that swallows the next flag.
      case "${2:-}" in
        ""|-*) ;;
        *) SERVICE_DIR="$2"; shift ;;
      esac
      shift
      ;;
    --service=*) SERVICE=1; SERVICE_DIR="${1#--service=}"; shift ;;
    --cloud)
      [ $# -ge 2 ] || { echo "install.sh: --cloud needs a URL" >&2; exit 2; }
      CLOUD_URL="$2"
      shift 2
      ;;
    --cloud=*) CLOUD_URL="${1#--cloud=}"; shift ;;
    -y|--yes) YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    # Every leading comment line, not a hardcoded range: the range silently stopped covering
    # the flag list the first time one was added. Falls back when the script came down a pipe,
    # where `$0` is not a file to read.
    -h|--help)
      if [ -r "$0" ]; then
        awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
      else
        echo "usage: curl -fsSL <your-jarvis>/install.sh | sh -s -- [--service] [--yes]"
      fi
      exit 0
      ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

if [ "$UNINSTALL" -eq 1 ]; then
  if [ -e "$PREFIX/jarvis" ]; then
    rm -f "$PREFIX/jarvis"
    echo "removed $PREFIX/jarvis"
  else
    echo "nothing to remove at $PREFIX/jarvis"
  fi
  echo "left $CONFIG_DIR and ~/.local/share/jarvis alone"
  exit 0
fi

# Reading a prompt when the script itself arrived on stdin would consume the script, so
# every question goes to the terminal directly and is skipped when there is not one.
ask() {
  [ "$YES" -eq 1 ] && return 0
  [ -r /dev/tty ] || { echo "install.sh: no terminal to ask on — re-run with --yes" >&2; exit 1; }
  printf '%s (Y/n) ' "$1" > /dev/tty
  read -r REPLY < /dev/tty
  case "$REPLY" in Y|y|"") return 0 ;; *) return 1 ;; esac
}

if ! command -v bun >/dev/null 2>&1; then
  echo "jarvis is built with bun, which is not on PATH."
  echo "this runs the official installer from https://bun.sh/install:"
  echo
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo
  if ask "install bun now?"; then
    curl -fsSL https://bun.sh/install | bash
    # The installer edits shell rc files, which do not apply to the shell already running.
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    PATH="$BUN_INSTALL/bin:$PATH"
    export PATH
  fi
  command -v bun >/dev/null 2>&1 || {
    echo "install.sh: bun is still not on PATH — install it and run this again." >&2
    exit 1
  }
fi

ask "install jarvis to $PREFIX?" || { echo "Installation cancelled."; exit 1; }

# Through a pipe there is no checkout to build from. Cloning is not a convenience here: the
# binary is compiled from source on this machine, so the source has to be present.
if [ -z "$REPO" ] || [ ! -f "$REPO/package.json" ]; then
  command -v git >/dev/null 2>&1 || { echo "install.sh: git is required to fetch the source" >&2; exit 1; }
  REPO=$(mktemp -d)
  trap 'rm -rf "$REPO"' EXIT
  echo "==> fetching the source"
  git clone --depth 1 "${JARVIS_REPO:-https://github.com/Maximus019BG/JARVIS.git}" "$REPO" >/dev/null 2>&1 ||
    { echo "install.sh: could not clone the jarvis repository" >&2; exit 1; }
  REPO="$REPO/tui"
fi

echo "==> installing dependencies"
cd "$REPO"
bun install --frozen-lockfile

echo "==> building (this takes a few minutes on a Pi — the binary is compiled here)"
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT
bun build --compile --outfile "$BUILD_DIR/jarvis" src/index.tsx

echo "==> installing to $PREFIX"
mkdir -p "$PREFIX"
# `install` is not on every minimal Linux image; cp + chmod always is.
cp "$BUILD_DIR/jarvis" "$PREFIX/jarvis.new"
chmod 755 "$PREFIX/jarvis.new"
mv -f "$PREFIX/jarvis.new" "$PREFIX/jarvis"

if [ ! -f "$CONFIG_DIR/jarvis.jsonc" ] && [ ! -f "$CONFIG_DIR/jarvis.json" ]; then
  mkdir -p "$CONFIG_DIR"
  cp "$REPO/jarvis.jsonc" "$CONFIG_DIR/jarvis.jsonc"
  [ -f "$REPO/jarvis.schema.json" ] && cp "$REPO/jarvis.schema.json" "$CONFIG_DIR/jarvis.schema.json"
  echo "==> seeded $CONFIG_DIR/jarvis.jsonc — edit it to set your providers and API keys"
  # Inserted after the opening brace rather than written over the file: the template is a
  # working config with providers and comments in it, and replacing it would be a downgrade.
  # Only into a config being created — rewriting an existing one would silently repoint a
  # machine somebody had already aimed somewhere else.
  if [ -n "$CLOUD_URL" ]; then
    awk -v url="$CLOUD_URL" '
      NR == 1 && $0 ~ /^[[:space:]]*\{/ { print; print "  \"cloud\": \"" url "\","; next }
      { print }
    ' "$CONFIG_DIR/jarvis.jsonc" > "$CONFIG_DIR/jarvis.jsonc.new" &&
      mv -f "$CONFIG_DIR/jarvis.jsonc.new" "$CONFIG_DIR/jarvis.jsonc"
    echo "==> pointed at $CLOUD_URL"
  fi
else
  echo "==> kept your existing config in $CONFIG_DIR"
fi

# Global agents and skills that ship with jarvis. Copied only when absent, so an edited
# copy is never clobbered — delete one and re-run this script to get the original back.
for SRC in "$REPO"/assets/global/agents/*.md; do
  [ -e "$SRC" ] || continue
  DEST="$CONFIG_DIR/agents/$(basename "$SRC")"
  if [ ! -e "$DEST" ]; then
    mkdir -p "$CONFIG_DIR/agents"
    cp "$SRC" "$DEST"
    echo "==> installed agent $(basename "$SRC" .md)"
  fi
done

# Per file rather than per directory: a skill that already exists still needs to receive
# reference files added since it was installed, and a directory-level guard would never
# deliver them. `cp -n` keeps an edited copy safe either way.
for SRC in "$REPO"/assets/global/skills/*/; do
  [ -d "$SRC" ] || continue
  NAME=$(basename "$SRC")
  NEW=""
  [ -e "$CONFIG_DIR/skills/$NAME" ] || NEW=" (new)"
  mkdir -p "$CONFIG_DIR/skills/$NAME"
  cp -Rn "$SRC". "$CONFIG_DIR/skills/$NAME/" 2>/dev/null || true
  echo "==> installed skill $NAME$NEW"
done

case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *)
    case "${SHELL##*/}" in
      fish) RC="$HOME/.config/fish/config.fish"; LINE="fish_add_path $PREFIX" ;;
      zsh)  RC="$HOME/.zshrc";                   LINE="export PATH=\"$PREFIX:\$PATH\"" ;;
      *)    RC="$HOME/.bashrc";                  LINE="export PATH=\"$PREFIX:\$PATH\"" ;;
    esac
    cat <<EOF

note: $PREFIX is not on your PATH. Add it:

  echo '$LINE' >> $RC && exec \$SHELL

EOF
    ;;
esac

if [ "$SERVICE" -eq 1 ]; then
  WORK_DIR="${SERVICE_DIR:-$HOME/jarvis}"
  mkdir -p "$WORK_DIR"
  UNIT_DIR=/etc/systemd/system
  if [ ! -w "$UNIT_DIR" ]; then
    echo "==> the worker service needs root; install it yourself:"
    echo "    sudo cp $REPO/assets/pi/jarvis-work.service $UNIT_DIR/jarvis-work@.service"
    echo "    sudo systemctl enable --now jarvis-work@$(id -un)"
  else
    cp "$REPO/assets/pi/jarvis-work.service" "$UNIT_DIR/jarvis-work@.service"
    systemctl daemon-reload
    # Enabled but not started: it needs credentials, and this runs before pairing. Starting
    # it now would only produce a restart loop for the reader to wonder about.
    systemctl enable "jarvis-work@$(id -un)" >/dev/null 2>&1 || true
    echo "==> installed the worker service — it starts on the next boot, or now with:"
    echo "    sudo systemctl start jarvis-work@$(id -un)"
  fi
  echo "    jobs will run in $WORK_DIR"
fi

if [ "$PI" -eq 1 ]; then
  # Templated on the invoking user (`jarvis-pi@user.service`) because the daemon reads the
  # calibration and credentials out of that user's XDG directories — running it as root
  # would look for them in the wrong home.
  UNIT_DIR=/etc/systemd/system
  if [ ! -w "$UNIT_DIR" ]; then
    echo "==> systemd units need root; copy them yourself:"
    echo "    sudo cp $REPO/assets/pi/*.service $UNIT_DIR/"
    echo "    sudo systemctl enable --now jarvis-pi@$(id -un) jarvis-kiosk@$(id -un)"
  else
    cp "$REPO/assets/pi/jarvis-pi.service" "$UNIT_DIR/jarvis-pi@.service"
    cp "$REPO/assets/pi/jarvis-kiosk.service" "$UNIT_DIR/jarvis-kiosk@.service"
    systemctl daemon-reload
    echo "==> installed systemd units"
    echo "    calibrate first:  jarvis pi calibrate"
    echo "    then:             sudo systemctl enable --now jarvis-pi@$(id -un) jarvis-kiosk@$(id -un)"
  fi
  for tool in rpicam-vid cage chromium-browser; do
    command -v "$tool" >/dev/null 2>&1 || echo "note: $tool is not on PATH — the Pi path needs it"
  done
fi

echo "installed $("$PREFIX/jarvis" --version 2>/dev/null || echo jarvis) to $PREFIX/jarvis"
echo
echo "next: run 'jarvis' and it will walk you through pairing this machine."
echo "      (or 'jarvis pair you@example.com' without the interface)"

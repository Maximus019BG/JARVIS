#!/bin/sh
# Builds jarvis and installs it on PATH. Works the same on macOS and Linux.
#
#   ./install.sh                     -> ~/.local/bin/jarvis
#   ./install.sh --prefix /usr/local/bin
#   ./install.sh --pi                also install the Raspberry Pi systemd units
#   ./install.sh --uninstall
#
# The binary is compiled here rather than downloaded, because bun embeds the host
# platform's libopentui into it — a Linux binary has to be built on Linux.
set -eu

PREFIX="${JARVIS_PREFIX:-$HOME/.local/bin}"
UNINSTALL=0
PI=0
REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<'EOF'
install.sh: bun is required to build jarvis and was not found on PATH.

Install it, then run this script again:

  curl -fsSL https://bun.sh/install | bash

EOF
  exit 1
fi

echo "==> installing dependencies"
cd "$REPO"
bun install --frozen-lockfile

echo "==> building"
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

for SRC in "$REPO"/assets/global/skills/*/; do
  [ -d "$SRC" ] || continue
  NAME=$(basename "$SRC")
  if [ ! -e "$CONFIG_DIR/skills/$NAME" ]; then
    mkdir -p "$CONFIG_DIR/skills"
    cp -R "$SRC" "$CONFIG_DIR/skills/$NAME"
    echo "==> installed skill $NAME"
  fi
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
echo "run 'jarvis' to start, or 'jarvis init' inside a project to scaffold .jarvis/"

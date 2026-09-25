#!/bin/zsh
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Kern 本机执行安装器当前仅支持 macOS。"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$HOME/.config/hermes-desktop"
CONFIG_FILE="$CONFIG_DIR/config.env"
PLIST="$HOME/Library/LaunchAgents/com.hermes.pm-next.desktop.plist"
LOG_DIR="$HOME/Library/Logs/Hermes"
mkdir -p "$CONFIG_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"

BASE_URL="${HERMES_BASE_URL:-http://127.0.0.1:3100}"
EMAIL="${HERMES_DESKTOP_EMAIL:-}"
WORKSPACE="${HERMES_DESKTOP_WORKSPACE:-$HOME}"

if [[ -z "$EMAIL" ]]; then
  printf "PM-next login email: "
  read EMAIL
fi
if [[ -z "$EMAIL" ]]; then
  echo "Email is required."
  exit 1
fi

if ! /usr/bin/security find-generic-password -s "Hermes PM-next" -a "$EMAIL" -w >/dev/null 2>&1; then
  printf "PM-next password (stored in macOS Keychain, not in config file): "
  read -s PASSWORD
  echo
  /usr/bin/security add-generic-password -U -s "Hermes PM-next" -a "$EMAIL" -w "$PASSWORD" >/dev/null
fi

cat > "$CONFIG_FILE" <<EOF
export HERMES_BASE_URL=$(printf %q "$BASE_URL")
export HERMES_DESKTOP_EMAIL=$(printf %q "$EMAIL")
export HERMES_DESKTOP_WORKSPACE=$(printf %q "$WORKSPACE")
export HERMES_DESKTOP_ALLOWED_ROOTS=$(printf %q "$HOME/Desktop,$HOME/Documents,$HOME/Downloads,$WORKSPACE")
export HERMES_DESKTOP_POLL_MS=2500
EOF
chmod 600 "$CONFIG_FILE"

NPM_BIN="$(command -v npm)"
if [[ -z "$NPM_BIN" ]]; then
  echo "npm not found."
  exit 1
fi

if [[ ! -x "$REPO_DIR/node_modules/.bin/tsx" ]]; then
  echo "Installing PM-next dependencies..."
  (cd "$REPO_DIR" && "$NPM_BIN" ci)
fi

if ! curl -fsS --max-time 3 "$BASE_URL/api/health" >/dev/null 2>&1; then
  echo "Warning: PM-next is not reachable at $BASE_URL yet."
  echo "The desktop LaunchAgent will stay installed and reconnect automatically when PM-next becomes available."
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hermes.pm-next.desktop</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>source "$CONFIG_FILE"; cd "$REPO_DIR"; "$NPM_BIN" run desktop</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG_DIR/desktop.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/desktop-error.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/com.hermes.pm-next.desktop" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/com.hermes.pm-next.desktop"

echo "Kern 本机执行已安装并启动。"
echo "Config: $CONFIG_FILE"
echo "Logs:   $LOG_DIR/desktop.log"
echo "Status: launchctl print gui/$UID/com.hermes.pm-next.desktop"
echo
echo "For UI automation in apps without APIs, grant Accessibility permission and add:"
echo "  export HERMES_DESKTOP_ALLOW_APPLESCRIPT=1"
echo "to $CONFIG_FILE, then restart the LaunchAgent."

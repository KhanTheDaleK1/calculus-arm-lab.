#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   PORT=/dev/ttyACM0 FQBN=arduino:avr:uno ./upload_sketch.sh /path/to/SketchFolder
#   ./upload_sketch.sh /path/to/Sketch.ino
# Defaults: PORT autodetected (first Uno) or /dev/ttyACM0, FQBN arduino:avr:uno

FQBN_DEFAULT="arduino:avr:uno"
PORT_DEFAULT="/dev/ttyACM0"

FQBN="${FQBN:-$FQBN_DEFAULT}"
PORT="${PORT:-}"

if [[ $# -lt 1 ]]; then
  echo "Provide a sketch folder or .ino file path" >&2
  exit 2
fi

INPUT="$1"
if [[ -d "$INPUT" ]]; then
  SKETCH_DIR="$INPUT"
elif [[ -f "$INPUT" && "$INPUT" == *.ino ]]; then
  SKETCH_DIR="$(dirname "$INPUT")"
else
  echo "Input must be a sketch directory or .ino file" >&2
  exit 2
fi

if [[ -z "${PORT}" ]]; then
  # Try to detect an Uno-like board and pick its port
  PORT=$(arduino-cli board list 2>/dev/null | awk '/arduino:avr:uno/ {print $1; exit}') || true
  PORT="${PORT:-$PORT_DEFAULT}"
fi

echo "FQBN: ${FQBN}"
echo "PORT: ${PORT}"
echo "SKETCH: ${SKETCH_DIR}"

arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH_DIR"

echo "Upload complete."
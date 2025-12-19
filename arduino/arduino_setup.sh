#!/usr/bin/env bash
set -euo pipefail

USER_NAME=${SUDO_USER:-${USER}}

info() { echo -e "\e[1;34m[INFO]\e[0m $*"; }
ok()   { echo -e "\e[1;32m[OK]\e[0m   $*"; }
warn() { echo -e "\e[1;33m[WARN]\e[0m $*"; }
err()  { echo -e "\e[1;31m[ERR]\e[0m  $*"; }

if [[ $EUID -ne 0 ]]; then
  err "Please run with sudo: sudo bash $0"
  exit 1
fi

info "User: ${USER_NAME}"

# Show current Arduino symlink if present
if [[ -d /dev/serial/by-id ]]; then
  info "Current serial devices:"
  ls -l /dev/serial/by-id || true
fi

# Ensure groups
info "Adding ${USER_NAME} to dialout and plugdev (idempotent)"
usermod -aG dialout "${USER_NAME}" || true
usermod -aG plugdev "${USER_NAME}" || true
ok "Group membership updated (re-login required to take effect)"

# Udev rules to set permissions and make ModemManager ignore Arduino
UDEV_FILE=/etc/udev/rules.d/99-arduino.rules
info "Writing ${UDEV_FILE}"
cat >"${UDEV_FILE}" <<'RULES'
# Arduino boards (legacy and new vendor IDs)
SUBSYSTEMS=="usb", ATTRS{idVendor}=="2341", MODE:="0666", GROUP="dialout"
SUBSYSTEMS=="usb", ATTRS{idVendor}=="2a03", MODE:="0666", GROUP="dialout"
# CDC ACM serial nodes typically used by Arduinos
KERNEL=="ttyACM*", MODE:="0666", GROUP="dialout"

# Ask ModemManager to ignore these devices (prevents port grabbing)
SUBSYSTEMS=="usb", ATTRS{idVendor}=="2341", ENV{ID_MM_DEVICE_IGNORE}="1"
SUBSYSTEMS=="usb", ATTRS{idVendor}=="2a03", ENV{ID_MM_DEVICE_IGNORE}="1"
RULES
ok "Wrote udev rules"

info "Reloading udev rules"
udate() {
  udevadm control --reload-rules
  udevadm trigger || true
}
udate
ok "udev reloaded"

# Optional: show ModemManager status
if systemctl list-unit-files | grep -q '^ModemManager.service'; then
  status=$(systemctl is-active ModemManager || true)
  info "ModemManager is ${status}. The udev rule asks it to ignore Arduino."
fi

info "Done. Please log out and back in (or reboot) to apply group changes."
info "Then reconnect the Arduino and check: ls -l /dev/serial/by-id"

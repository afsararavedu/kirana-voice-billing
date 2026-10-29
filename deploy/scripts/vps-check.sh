#!/usr/bin/env bash
# Read-only compatibility check for the VPS. Changes nothing. Run before the first deploy:
#   DOMAIN=billing.example.in ./scripts/vps-check.sh
# Exit code 0 = ready, 1 = a blocking problem was found (details printed).
set -uo pipefail

fail=0
ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; }
bad()  { printf '  [FAIL] %s\n' "$*"; fail=1; }

echo "== System"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "OS: ${PRETTY_NAME:-unknown}"
else
  warn "cannot read /etc/os-release"
fi
arch=$(uname -m)
case "$arch" in
  x86_64|aarch64) ok "architecture: $arch (all images are published for it)" ;;
  *) bad "architecture $arch: postgres/node/caddy images may not exist for it" ;;
esac
virt=$(systemd-detect-virt 2>/dev/null || echo unknown)
case "$virt" in
  openvz|lxc|lxc-libvirt) bad "virtualisation '$virt': Docker is unreliable here; a KVM VPS is required" ;;
  *) ok "virtualisation: $virt" ;;
esac
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 1000 ]; then bad "RAM ${mem_mb} MB: at least 1 GB needed (2 GB recommended)"
elif [ "$mem_mb" -lt 1900 ]; then warn "RAM ${mem_mb} MB: works, but add swap and avoid building images on the VPS under load"
else ok "RAM ${mem_mb} MB"; fi
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$swap_mb" -gt 0 ] && ok "swap ${swap_mb} MB" || warn "no swap configured"
disk_gb=$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')
if [ "$disk_gb" -lt 5 ]; then bad "free disk ${disk_gb} GB: at least 5 GB needed (images + database + backups)"
else ok "free disk ${disk_gb} GB"; fi

echo "== Docker"
if command -v docker >/dev/null 2>&1; then
  ok "docker: $(docker --version)"
  if docker compose version >/dev/null 2>&1; then ok "compose: $(docker compose version --short)"
  else bad "Docker Compose v2 plugin missing (docker compose ...)"; fi
  if docker info >/dev/null 2>&1; then ok "docker daemon reachable by $(id -un)"
  else bad "cannot talk to the docker daemon (not running, or $(id -un) is not in the docker group)"; fi
else
  bad "docker is not installed"
fi

echo "== Network"
for port in 80 443; do
  if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
    owner=$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*users:((\"\([^\"]*\)\".*/\1/p' | head -n1)
    bad "port $port is already in use${owner:+ by $owner} (Caddy needs 80 and 443)"
  else
    ok "port $port free"
  fi
done
if command -v ufw >/dev/null 2>&1; then
  ufw_state=$(ufw status 2>/dev/null | head -n1 || true)
  ok "ufw: ${ufw_state:-unknown} (80/tcp, 443/tcp and 443/udp must be allowed)"
fi
if [ -n "${DOMAIN:-}" ]; then
  resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')
  public=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  if [ -z "$resolved" ]; then bad "$DOMAIN does not resolve: add an A record pointing to this VPS"
  elif [ -n "$public" ] && [ "$resolved" != "$public" ]; then
    bad "$DOMAIN resolves to $resolved but this VPS is $public (HTTPS certificates will fail)"
  else ok "$DOMAIN → $resolved${public:+ (this VPS: $public)}"; fi
else
  warn "DOMAIN not set: DNS not checked"
fi

echo "== Time"
if command -v timedatectl >/dev/null 2>&1; then
  sync=$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)
  [ "$sync" = "yes" ] && ok "clock synchronised (NTP)" || warn "clock sync: $sync (bill times and certificates need a correct clock)"
fi

echo
if [ "$fail" -eq 0 ]; then echo "VPS check passed."; else echo "VPS check found blocking problems."; fi
exit "$fail"

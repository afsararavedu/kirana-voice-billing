# Deployment and recovery runbook — Hostinger VPS

Everything runs on one VPS with Docker Compose. Files: [`deploy/`](../deploy). Step-by-step for
Hostinger, with every configuration variable explained: [`hostinger-guide.md`](hostinger-guide.md).

```text
 Internet ──443/80──▶ web (Caddy: HTTPS, static app, /api proxy) ──▶ api (Node, port 4000)
                                                                       │  network "backend"
                                                                       ▼  (internal, no internet)
                                                                     db (PostgreSQL 17, volume pgdata)
```

- Only Caddy publishes ports. PostgreSQL and the API are unreachable from the internet.
- The API connects as **`kirana_app`**: it can read and write rows, but cannot change the schema,
  read migration history, truncate tables, or update/delete history (bills, payments, returns,
  stock ledger, audit log). Migrations run separately as **`kirana_owner`**. The `postgres`
  superuser is used only for setup, backups and restores. (Verified against real PostgreSQL by
  `apps/api/test/deploy.test.ts`.)
- Secrets live only in `deploy/.env` and `deploy/api.env` on the VPS (`chmod 600`), never in Git.

## 1. One-time server preparation

Needs a **KVM** VPS (Hostinger "KVM" plans; not OpenVZ), Ubuntu 24.04 LTS, ≥ 2 GB RAM recommended
(1 GB works with swap), ≥ 10 GB free disk, and a domain whose **A record points to the VPS**.

As root on the VPS:

```bash
adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy: /home/deploy/.ssh
# SSH: keys only (edit /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no), then:
systemctl reload ssh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
apt-get update && apt-get install -y ca-certificates curl unattended-upgrades
# Docker Engine + Compose plugin: follow https://docs.docker.com/engine/install/ubuntu/ then
usermod -aG docker deploy
# Swap on small plans:
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Backup directory, owned by the container's postgres user (uid 999):
install -d -o 999 -g 999 -m 700 /var/backups/kirana
```

## 2. Code and configuration (as `deploy`)

Copy the repository to `/opt/kirana` (`git clone`, or from your PC:
`scp -r kirana-voice-billing deploy@VPS:/opt/kirana` without `node_modules`, `dist`, `.pgdata*`).

```bash
cd /opt/kirana/deploy
cp .env.example .env && cp api.env.example api.env && chmod 600 .env api.env
openssl rand -hex 24   # run three times: POSTGRES_SUPERUSER_PASSWORD, KIRANA_OWNER_PASSWORD, KIRANA_APP_PASSWORD
nano .env              # DOMAIN, ACME_EMAIL, the three passwords
nano api.env           # voice settings; ANTHROPIC_API_KEY only if VOICE_EXTRACTOR=anthropic
chmod +x scripts/*.sh postgres/init/*.sh
```

Passwords are applied when the database volume is **first** created; see §8 to change them later.

## 3. Compatibility check (read-only)

```bash
DOMAIN=billing.example.in ./scripts/vps-check.sh
```

Checks OS, architecture, virtualisation (fails on OpenVZ/LXC), RAM, swap, disk, Docker and
Compose, that ports 80/443 are free, that `DOMAIN` resolves to this VPS, and clock sync. Fix every
`[FAIL]` before deploying.

## 4. Staging, then production

1. **Staging first:** set `DOMAIN=staging.<your-domain>` (DNS A record to the VPS) and run
   `COMPOSE_PROJECT_NAME=kirana-staging ./scripts/deploy.sh`. Then, in a browser: register, create
   a store, add two products, make a bill (manual and voice), print a receipt, record a return,
   open the daily report. Run a backup and the restore drill (§6). Record the results below.
2. **Remove staging** (it holds only test data):
   `COMPOSE_PROJECT_NAME=kirana-staging docker compose down -v` — the `-v` deletes the staging
   volumes; never run it without `COMPOSE_PROJECT_NAME=kirana-staging`.
3. **Production:** set `DOMAIN` to the real hostname and run `./scripts/deploy.sh`.

`deploy.sh` stops at the first failure and runs, in order: config check → image build → if the
database already has data, a **verified backup** (pg_dump + table-of-contents check + checksum;
migration is skipped if the backup fails) → `prisma migrate deploy` as `kirana_owner` → grants →
start API and Caddy → readiness check over HTTPS (`/api/v1/health/ready`).

## 5. Backups

```bash
./scripts/backup.sh       # prints /var/backups/kirana/kirana-<UTC>.dump
```

Schedule it daily (crontab of `deploy`; 21:00 UTC = 02:30 IST):

```cron
0 21 * * * cd /opt/kirana/deploy && ./scripts/backup.sh >> /var/log/kirana-backup.log 2>&1
```

Retention: dumps older than `KEEP_DAYS` (14) are deleted, but the newest `KEEP_MIN` (7) are always
kept. **Copy backups off the VPS** — a VPS failure takes local backups with it. E.g. from your PC
weekly: `scp deploy@VPS:/var/backups/kirana/kirana-*.dump* D:\kirana-backups\`, or enable
Hostinger's VPS snapshots in addition (snapshots alone are not database-consistent backups).

## 6. Restore drill (do it at go-live, then monthly)

```bash
./scripts/restore.sh --drill /var/backups/kirana/kirana-<UTC>.dump
```

Restores into a scratch database `kirana_restore_drill`, prints counts for the restored copy and
the live database (stores, products, bills, sales total, stock movements, history guards,
migrations), then drops the scratch database. The live database is not touched. A good drill:
the copy's counts equal the live counts at backup time, `history_guards` is 7, `migrations` equals
the number of folders in `apps/api/prisma/migrations`.

| Date | Backup file | Copy: bills / sales total | Live at backup | Duration | By  |
| ---- | ----------- | ------------------------- | -------------- | -------- | --- |
|      |             |                           |                |          |     |

## 7. Restoring the live database (disaster recovery)

Only when the live data is lost or corrupted. Everything after the chosen backup is lost.

```bash
CONFIRM=replace-live-database ./scripts/restore.sh --live /var/backups/kirana/kirana-<UTC>.dump
```

It verifies the checksum, takes a **safety backup** of the current state, stops the API, recreates
the database, restores, re-applies grants, prints the counts and starts the API. On a new VPS:
prepare it (§1–3), copy the dump into `/var/backups/kirana`, run `deploy.sh` once (creates an empty
database), then the command above.

## 8. Updates, rollback and maintenance

- **New release:** copy the new code, then `RELEASE=<yyyymmdd-n> ./scripts/deploy.sh`. Images are
  tagged per release.
- **Rollback (no schema change in the release):** `RELEASE=<previous> docker compose up -d api web`.
- **Rollback of a migration:** migrations are forward-only; restore the backup `deploy.sh` took
  just before migrating (§7), then start the previous release.
- **Change a database password:** `docker compose exec -u postgres db psql -c "ALTER ROLE kirana_app PASSWORD '<new>'"`,
  update `deploy/.env`, `docker compose up -d api`.
- **Logs:** `docker compose logs -f api` / `web` (JSON; transcripts, cookies and keys are redacted).
- **Status:** `docker compose ps`; health: `curl https://$DOMAIN/api/v1/health/ready`. Add an
  external uptime check on that URL (e.g. UptimeRobot) to be told when it fails.
- **Disk:** `docker system df`; prune old images with `docker image prune` after a good release.
- **OS updates:** `unattended-upgrades` installs security updates; reboot in a quiet hour.

## 9. What has and has not been verified

Verified on the development PC (no Docker there): least-privilege roles + migrations as the owner +
the full billing flow as `kirana_app` with production cookies on real PostgreSQL; compose/Caddy/
Dockerfile invariants; the production web build running under the Caddyfile's Content-Security-
Policy. **Not yet run:** the Docker image builds, Caddy itself, the shell scripts, a backup, the
restore drill and the HTTPS deploy — they run for the first time on the VPS in step 4, and the
results go in the table in §6 and in `docs/implementation-status.md`.

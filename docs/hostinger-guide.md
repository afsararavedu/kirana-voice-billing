# Deploying on Hostinger — step by step

This is the detailed, click-by-click companion to the runbook [`deployment.md`](deployment.md). It
covers buying and preparing the server in Hostinger's hPanel, getting the code from the private
GitHub repository, **every configuration variable**, the first deploy, backups and updates.

Example values used below — replace them with your own:

| Placeholder                  | Example                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| Your domain                  | `waycupchai.com`                                             |
| Hostname for the billing app | `billing.waycupchai.com` (staging: `staging.waycupchai.com`) |
| VPS IP address               | `203.0.113.10`                                               |
| GitHub repository            | `afsararavedu/kirana-voice-billing` (private)                |

## 0. Which Hostinger product?

| Hostinger product                                               | Works for this app? | Why                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KVM VPS** (any "KVM" plan)                                    | **Yes — use this**  | Runs the ready-made Docker setup in `deploy/`: PostgreSQL, the API and HTTPS on one server.                                                                                                                                            |
| Business / Cloud **web hosting** ("Node.js Web Apps" in hPanel) | Not as it is        | Hostinger's shared hosting offers **MySQL only**; this app needs PostgreSQL (append-only triggers, roles). It would need an external PostgreSQL service plus code changes — see [§12](#12-why-not-shared-web-hosting-business--cloud). |
| Single / Premium web hosting                                    | No                  | No Node.js apps.                                                                                                                                                                                                                       |

**Plan size:** at least 2 GB RAM (e.g. KVM 2) is recommended; 1 GB works with the swap file from
step 3.6. ≥ 10 GB free disk.

## 1. Buy and set up the VPS in hPanel

1. hPanel → **VPS** → buy a **KVM** plan.
2. During setup choose:
   - **Location:** the data centre nearest your stores (e.g. India, if offered).
   - **Operating system:** plain **Ubuntu 24.04 LTS** (no control panel).
   - **Root password:** a long random one; store it in your password manager.
   - **SSH key:** recommended. On your Windows PC, create one in PowerShell and paste the contents
     of the `.pub` file into hPanel → VPS → **Settings → SSH keys**:

     ```bash
     ssh-keygen -t ed25519 -C "kirana-vps"
     ```

     ```bash
     type $env:USERPROFILE\.ssh\id_ed25519.pub
     ```

3. Note the VPS **IP address** shown on the VPS overview page.
4. hPanel → VPS → **Firewall** (if your plan shows it): allow inbound TCP **22**, **80**, **443**
   and UDP **443**; block everything else. (The server's own `ufw` firewall in step 3 does the same.)

## 2. Point the domain at the VPS (DNS)

If the domain is managed in Hostinger: hPanel → **Domains** → your domain → **DNS / Nameservers**
→ **DNS records**. Add:

| Type | Name      | Points to      | TTL  |
| ---- | --------- | -------------- | ---- |
| A    | `billing` | `203.0.113.10` | 3600 |
| A    | `staging` | `203.0.113.10` | 3600 |

(If the domain is elsewhere, add the same A records at that provider.) Check from your PC after a
few minutes — it must print the VPS IP:

```bash
nslookup billing.waycupchai.com
```

Don't point the main `waycupchai.com` / `www` records at the VPS unless you want the billing app
there; your existing website keeps working.

## 3. Prepare the server (once, as root)

Connect from Windows PowerShell:

```bash
ssh root@203.0.113.10
```

Then run each block on the VPS.

**3.1 Updates and basic tools**

```bash
apt-get update && apt-get -y upgrade && apt-get install -y ca-certificates curl git ufw unattended-upgrades
```

**3.2 A non-root `deploy` user with your SSH key**

```bash
adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy: /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
passwd deploy   # a password for sudo
```

Open a **second** PowerShell window and check `ssh deploy@203.0.113.10` works **before** the next
step, or you can lock yourself out.

**3.3 SSH: keys only, no root login** — edit `/etc/ssh/sshd_config` (`nano /etc/ssh/sshd_config`),
set `PasswordAuthentication no` and `PermitRootLogin no`, then:

```bash
systemctl reload ssh
```

**3.4 Firewall**

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

**3.5 Docker Engine + Compose plugin** (Docker's official repository)

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
docker --version && docker compose version
```

**3.6 Swap** (needed on 1 GB plans, harmless on bigger ones)

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**3.7 Time zone and folders.** The server clock stays UTC (the app converts to IST itself).

```bash
install -d -o 999 -g 999 -m 700 /var/backups/kirana   # owned by the database container's user
install -d -o deploy -g deploy /opt/kirana
```

Log out (`exit`) and continue as `deploy`: `ssh deploy@203.0.113.10`.

## 4. Get the code from the private GitHub repository

The VPS needs its own **read-only deploy key** (never your GitHub password).

```bash
ssh-keygen -t ed25519 -f ~/.ssh/kirana_deploy -N "" -C "kirana-vps-deploy"
cat ~/.ssh/kirana_deploy.pub
```

On GitHub: repository **kirana-voice-billing → Settings → Deploy keys → Add deploy key**. Title
`hostinger-vps`, paste the key, leave **Allow write access unticked**, save. Then on the VPS:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/kirana_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
git clone git@github.com:afsararavedu/kirana-voice-billing.git /opt/kirana
cd /opt/kirana/deploy && chmod +x scripts/*.sh postgres/init/*.sh
```

(Answer `yes` to GitHub's host-key question the first time.)

## 5. Configuration — every variable

There are exactly **two** configuration files, both only on the VPS, both `chmod 600`, both
ignored by Git. Nothing else needs to be configured: the web app has no environment variables
(it calls `/api/v1` on its own domain, so no API URL or key ever goes into the browser).

```bash
cd /opt/kirana/deploy
cp .env.example .env && cp api.env.example api.env && chmod 600 .env api.env
```

### 5.1 Generate the three database passwords

Run this three times and paste one value into each password line below. Hex values are safe inside
connection URLs (avoid `@ : / ? #` in hand-made passwords).

```bash
openssl rand -hex 24
```

### 5.2 `deploy/.env` — server, HTTPS and database (`nano .env`)

```ini
DOMAIN=billing.waycupchai.com
ACME_EMAIL=you@example.com
POSTGRES_SUPERUSER_PASSWORD=<hex value 1>
KIRANA_OWNER_PASSWORD=<hex value 2>
KIRANA_APP_PASSWORD=<hex value 3>
BACKUP_DIR=/var/backups/kirana
KEEP_DAYS=14
KEEP_MIN=7
LOG_LEVEL=info
```

| Variable                      | Required | What it does                                                                                                                                                                           |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                      | yes      | Hostname the app is served on. Caddy gets a free Let's Encrypt HTTPS certificate for it, and the API accepts logins only from `https://<DOMAIN>`. Its A record must point to this VPS. |
| `ACME_EMAIL`                  | yes      | Your e-mail for Let's Encrypt certificate expiry notices.                                                                                                                              |
| `POSTGRES_SUPERUSER_PASSWORD` | yes      | PostgreSQL `postgres` superuser — used only for setup, backups and restores.                                                                                                           |
| `KIRANA_OWNER_PASSWORD`       | yes      | `kirana_owner` role — owns the tables, used only to run migrations.                                                                                                                    |
| `KIRANA_APP_PASSWORD`         | yes      | `kirana_app` role — what the running API uses: read/write rows, no schema changes, cannot alter bill/payment/stock/audit history.                                                      |
| `BACKUP_DIR`                  | no       | Where `backup.sh` writes dumps on the VPS. Default `/var/backups/kirana`.                                                                                                              |
| `KEEP_DAYS`                   | no       | Delete backups older than this many days. Default 14.                                                                                                                                  |
| `KEEP_MIN`                    | no       | Always keep at least this many newest backups, however old. Default 7.                                                                                                                 |
| `LOG_LEVEL`                   | no       | API log detail: `fatal`, `error`, `warn`, `info` (default), `debug`, `trace`, `silent`.                                                                                                |

The three passwords take effect only when the database is **first** created. To change one later,
see [`deployment.md` §8](deployment.md#8-updates-rollback-and-maintenance).

### 5.3 `deploy/api.env` — application settings (`nano api.env`)

The defaults in the example file are production-ready; most stores change nothing.

```ini
SESSION_TTL_HOURS=168
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20
SPEECH_PROVIDER=browser
VOICE_EXTRACTOR=rules
VOICE_LLM_TIMEOUT_MS=15000
VOICE_RATE_LIMIT_MAX=30
```

| Variable                    | Default           | Allowed values / meaning                                                                                                                                                                     |
| --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_TTL_HOURS`         | `168` (7 days)    | 1–720. How long a sign-in lasts.                                                                                                                                                             |
| `RATE_LIMIT_WINDOW_MS`      | `60000`           | Window for the general request limit, in milliseconds.                                                                                                                                       |
| `RATE_LIMIT_MAX`            | `300`             | Requests per window per IP address. Raise it if many tills share one shop internet connection.                                                                                               |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Window for sign-in / registration attempts.                                                                                                                                                  |
| `AUTH_RATE_LIMIT_MAX`       | `20`              | Sign-in attempts per window per IP (slows password guessing).                                                                                                                                |
| `SPEECH_PROVIDER`           | `browser`         | `browser`: the phone/PC's own speech recognition (in Chrome, Google processes the audio; this app never receives audio). `none`: voice off, typed orders only.                               |
| `VOICE_EXTRACTOR`           | `rules`           | `rules`: built-in parser, no key, no internet. `anthropic`: Claude understands the order (falls back to `rules` on any failure) — needs `ANTHROPIC_API_KEY`.                                 |
| `ANTHROPIC_API_KEY`         | —                 | Only with `VOICE_EXTRACTOR=anthropic`. Your key from the Anthropic Console. Lives only in this file on the server, never in the browser (the build fails if it ever reaches the web bundle). |
| `ANTHROPIC_MODEL`           | `claude-opus-5-5` | Only with `anthropic`: `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5` (anything else is refused at start-up). Sonnet/Haiku are cheaper and faster.                             |
| `VOICE_LLM_TIMEOUT_MS`      | `15000`           | 1000–60000. How long to wait for Claude before falling back to `rules`.                                                                                                                      |
| `VOICE_RATE_LIMIT_MAX`      | `30`              | Voice requests per user per minute.                                                                                                                                                          |

### 5.4 Set automatically — do **not** put these in either file

`docker-compose.yml` sets them so they can't be got wrong:

| Variable        | Value set by Compose                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `production`                                                                                    |
| `PORT`          | `4000` (inside the private network; only Caddy is reachable from outside)                       |
| `DATABASE_URL`  | `postgresql://kirana_app:<KIRANA_APP_PASSWORD>@db:5432/kirana…` (migrations use `kirana_owner`) |
| `WEB_ORIGINS`   | `https://<DOMAIN>`                                                                              |
| `COOKIE_SECURE` | `true` (the API refuses to start in production without it)                                      |
| `TRUST_PROXY`   | `1` (exactly one proxy, Caddy, in front)                                                        |

Two variables are given on the command line, not in files: `RELEASE` (a label for the image
version, defaults to the current UTC time) and `COMPOSE_PROJECT_NAME` (only for staging).

The API checks every setting at start-up and stops with the **names** (never the values) of any
that are wrong — see `docker compose logs api`.

## 6. Compatibility check (read-only)

```bash
cd /opt/kirana/deploy
DOMAIN=staging.waycupchai.com ./scripts/vps-check.sh
```

Fix every `[FAIL]` (wrong virtualisation, DNS not pointing here yet, port 80/443 in use, no Docker…).

## 7. Staging first, then production

These scripts and Docker images have been checked on the development PC but have **not yet been
run on a real VPS**, so do staging first and note anything that fails.

**7.1 Staging** — set `DOMAIN=staging.waycupchai.com` in `.env`, then:

```bash
COMPOSE_PROJECT_NAME=kirana-staging ./scripts/deploy.sh
```

It builds, starts PostgreSQL, migrates, starts the API and Caddy, and waits until
`https://staging.waycupchai.com/api/v1/health/ready` answers (the first HTTPS certificate can take
a minute). Then in a browser, on a phone and a PC:

1. Create an account, create a store, fill in store details (address, phone, GSTIN, invoice prefix).
2. Add two products (one by kg, one by piece), or import a CSV.
3. Make a manual bill and a voice bill; print the receipt; make a return.
4. Open the daily report, low stock and the activity log.
5. Run a backup and the restore drill (§9) and fill in the drill table in `deployment.md` §6.

**7.2 Remove staging** (test data only; `-v` deletes its database — never run it without the
project name):

```bash
COMPOSE_PROJECT_NAME=kirana-staging docker compose down -v
```

**7.3 Production** — set `DOMAIN=billing.waycupchai.com` in `.env`, then:

```bash
./scripts/deploy.sh
```

Open `https://billing.waycupchai.com`, create the owner account and the real store.

## 8. Daily backups

```bash
crontab -e
```

Add (21:00 UTC = 02:30 IST):

```cron
0 21 * * * cd /opt/kirana/deploy && ./scripts/backup.sh >> /home/deploy/kirana-backup.log 2>&1
```

**Copy backups off the VPS** at least weekly — e.g. from Windows PowerShell:

```bash
scp deploy@203.0.113.10:/var/backups/kirana/kirana-*.dump* D:\kirana-backups\
```

Hostinger VPS snapshots (hPanel → VPS → **Snapshots & backups**) are a useful extra, but are not a
substitute for database dumps.

## 9. Restore drill (at go-live, then monthly)

```bash
ls -1t /var/backups/kirana/*.dump | head -1
./scripts/restore.sh --drill /var/backups/kirana/kirana-<UTC>.dump
```

It restores into a scratch database, prints counts next to the live ones, and drops the scratch copy;
the live data is not touched. Real disaster recovery: [`deployment.md` §7](deployment.md#7-restoring-the-live-database-disaster-recovery).

## 10. Updating to a new version

On your PC: commit and push to GitHub. On the VPS:

```bash
cd /opt/kirana && git pull --ff-only
cd deploy && RELEASE=$(date -u +%Y%m%d)-1 ./scripts/deploy.sh
```

`deploy.sh` takes a verified backup before migrating. Rollback and maintenance commands:
[`deployment.md` §8](deployment.md#8-updates-rollback-and-maintenance).

## 11. Troubleshooting

| Symptom                                    | Check                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `deploy.sh` stuck on "health"              | `docker compose logs web` — certificate errors mean DNS doesn't point here yet or port 80 is blocked.  |
| API restarts in a loop                     | `docker compose logs api` — "Invalid configuration" lists the wrong variable names.                    |
| "password authentication failed"           | Passwords in `.env` were changed after the database was created — use `ALTER ROLE` (deployment.md §8). |
| Sign-in or saving is refused ("forbidden") | You are opening the app on a different hostname than `DOMAIN`; use exactly `https://<DOMAIN>`.         |
| Out of memory during the image build       | Add the swap file (step 3.6) or use a bigger plan.                                                     |
| Status at a glance                         | `docker compose ps` and `curl https://billing.waycupchai.com/api/v1/health/ready`                      |

## 12. Why not shared web hosting (Business / Cloud)?

Hostinger's Business and Cloud web hosting can run Node.js apps from GitHub ("Node.js Web Apps" in
hPanel, environment variables set in the site dashboard), but:

1. **No PostgreSQL.** Hostinger's shared plans provide MySQL only. The app would have to use an
   external PostgreSQL service (e.g. Supabase or Neon), set up by hand with the two roles and
   grants from `deploy/postgres/`, with backups depending on that provider.
2. **No web server for the React app.** On the VPS, Caddy serves the web app and its security
   headers. On shared hosting the Node.js API would have to serve the built web app itself — a
   code change not made yet.
3. **No shell for migrations.** Migrations would have to be run from your PC against the external
   database before each release.
4. Apps there are stopped when idle and restarted on the next request, so the first bill of the
   morning is slower.

It is possible, but it is a separate change with its own testing. The VPS route above works with
the code as it is.

# Kirana Voice Billing

Multilingual (Telugu, Hindi, Urdu, English) voice billing and inventory for Indian kirana stores.
Engineering rules live in [`CLAUDE.md`](CLAUDE.md); progress in
[`docs/implementation-status.md`](docs/implementation-status.md); roadmap in
[`docs/phased-plan.md`](docs/phased-plan.md).

| Package           | What                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `packages/shared` | Zod schemas, language constants and DTO types shared by API + web |
| `apps/api`        | Node + Express 5 + Prisma 6 + PostgreSQL, REST under `/api/v1`    |
| `apps/web`        | React 19 + Vite + i18next SPA                                     |

## Local development

Requires Node 22+. No local PostgreSQL or Docker is needed: `dev:db` runs real PostgreSQL 17 binaries
via `embedded-postgres` (dev/test only).

```bash
npm install
```

```bash
npm run dev:db
```

Copy `apps/api/.env.example` to `apps/api/.env` and set `DATABASE_URL` to the URL `dev:db` prints.
Then, in two more terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:5173. The web dev server proxies `/api` to the API on :4000, so the session
cookie stays first-party.

## Checks

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run e2e
```

`npm test` starts a throwaway PostgreSQL, applies the committed migrations with
`prisma migrate deploy`, and runs API integration tests (including cross-tenant access attempts)
against it. `npm run e2e` starts its own isolated API (:4100) and web (:5174) servers. First run
needs `npx playwright install chromium` in `apps/web`.

## Database migrations

Schema: `apps/api/prisma/schema.prisma`. Create a migration against your dev DB:

```bash
npx -w @kirana/api prisma migrate dev --name <change>
```

Production migrations run only as an explicit deployment step after a verified backup
(`deploy/scripts/deploy.sh` does both, as the schema-owner role).

## Deploying (Hostinger VPS)

Docker Compose stack in [`deploy/`](deploy): PostgreSQL 17, the API, and Caddy (automatic HTTPS,
static web app, `/api` proxy). Step-by-step: [`docs/deployment.md`](docs/deployment.md) —
server preparation, `deploy/.env` + `deploy/api.env` (copied from the `.example` files; never
committed), `scripts/vps-check.sh`, staging then production with `scripts/deploy.sh`, daily
`scripts/backup.sh`, and the `scripts/restore.sh --drill` restore drill. Click-by-click for
Hostinger (hPanel, DNS, private GitHub repo, every configuration variable):
[`docs/hostinger-guide.md`](docs/hostinger-guide.md).

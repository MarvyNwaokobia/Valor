# Railway Migration Runbook (Render + Neon → Railway Hobby)

> **✅ COMPLETED.** The API + Postgres now run on one Railway Hobby project (`Valor` /
> `production`). Live API: **https://valor-production.up.railway.app**. Render + Neon are
> decommissioned. The runbook below is kept for reference / disaster recovery.

Goal: move the Valor API and its database onto **one** Railway Hobby project, then
decommission Render and Neon. The repo is already Railway-ready (`apps/api/railway.toml`
+ `Dockerfile`); this is a data + wiring job, not a code job.

## ⚠️ The one rule that matters

**Do NOT revive the old Railway project.** Your live data lives in **Neon** (migrated
~2026-07-12 and accruing ever since). The old Railway DB, if it still exists, is a stale
snapshot from before that and would wipe every player's progress since. Always
`pg_dump` **from Neon** into a **fresh** Railway Postgres.

---

## Step 1 — Subscribe + create the project
1. railway.com → upgrade to **Hobby** ($5/mo).
2. **New Project** → name it (e.g. `valor`).

## Step 2 — Add Postgres
1. In the project: `+ New` → `Database` → `PostgreSQL`.
2. Open the Postgres service → **Variables** → copy `DATABASE_URL` (the *public* one for
   the dump step below; the app will use the internal reference).

## Step 3 — Copy the data from Neon
Railway Postgres is a **direct** connection (no PgBouncer), so none of the
Neon/Supabase pooler workarounds apply. Schema + data come over in one dump — the API
does **not** auto-run migrations, so a full dump is exactly right.

```bash
# NEON_URL   = Neon dashboard → Connection Details → connection string
# RAILWAY_URL = Railway Postgres service → Variables → DATABASE_URL (public)

# 1. Dump Neon (schema + data), no owner/ACL noise
pg_dump "$NEON_URL" --no-owner --no-acl --format=custom -f valor_neon.dump

# 2. Restore into the fresh Railway Postgres
pg_restore --no-owner --no-acl --clean --if-exists -d "$RAILWAY_URL" valor_neon.dump

# 3. VERIFY row counts match before trusting the cutover
psql "$NEON_URL"    -c "SELECT 'players' t, count(*) FROM players
                        UNION ALL SELECT 'gdollar_ledger', count(*) FROM gdollar_ledger;"
psql "$RAILWAY_URL" -c "SELECT 'players' t, count(*) FROM players
                        UNION ALL SELECT 'gdollar_ledger', count(*) FROM gdollar_ledger;"
```
If a table is missing on Railway, the dump/restore failed — stop and re-run, do not
proceed on partial data.

## Step 4 — Add the API service
1. `+ New` → `GitHub Repo` → select the Valor repo.
2. Service → **Settings** → set **Root Directory = `apps/api`** (monorepo). Railway then
   finds `railway.toml` + `Dockerfile` and builds via Docker automatically.
3. Networking: the Dockerfile `EXPOSE 8080`s and the app binds `0.0.0.0:8080`, so Railway
   auto-targets 8080. Leave `BIND_ADDR` at the default (or set `0.0.0.0:8080`).

## Step 5 — Set the environment variables
Set these on the **API service** (Variables tab). For the database, use Railway's
reference so it auto-wires: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.

> ⚠️ `apps/api/.env.example` is INCOMPLETE — it omits several vars the code reads. This
> table is the authoritative list (from `grep env::var` over `apps/api/src`).

| Variable | Required? | Where to get it / value |
|---|---|---|
| `DATABASE_URL` | **Yes** | `${{Postgres.DATABASE_URL}}` (Railway reference) |
| `BIND_ADDR` | No | `0.0.0.0:8080` (default) |
| `RUST_LOG` | No | `info` |
| `CELO_RPC_URL` | No | `https://forno.celo.org` |
| `GOOD_DOLLAR_API_URL` | No | `https://gooddollar-api.gooddollar.org` |
| `BACKEND_PRIVATE_KEY` | **Yes** (rewards) | **Secret** — copy from Render / your `apps/api/.env`. Signs reward claims; lose it = no payouts. |
| `VALOR_APP_ADDRESS` | Yes | App wallet registered on Engagement Rewards. From Render / `.env`. |
| `ENGAGEMENT_REWARDS_CONTRACT` | No | Blank = default `0x25db74CF4E7BA120526fd87e159CF656d94bAE43` |
| `GAME_RECORD_CONTRACT` | Yes (chain writes) | From Render / deploy output |
| `MARKETPLACE_CONTRACT` | Yes (relay buys) | From Render / deploy output |
| `REWARD_POOL_CONTRACT` | Yes (rank-up G$) | From Render / deploy output |
| `G_TOKEN_CONTRACT` | Yes | From Render / deploy output |
| `ENDLESS_REWARD_POOL_CONTRACT` | Yes (Endless) | `0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0` |
| `ENDLESS_MIN_SECS_PER_WAVE` | Yes (Endless) | From Render |
| `ENDLESS_WEEKLY_CAP_G` | No | From Render if set |
| `ENDLESS_POOL_WARN_G` | No | From Render if set |
| `DECAY_CRON_SECRET` | **Yes** | **Secret** — must match the GitHub Actions `DECAY_CRON_SECRET`. |
| `PVP_SERVER_SECRET` | **Yes** (PvP) | **Secret** — from Render / `.env`. |
| `ADMIN_JWT_SECRET` | Yes (admin) | **Secret** — from Render / `.env`. |
| `ADMIN_WALLETS` | Yes (admin) | Comma-separated admin wallets. From Render. |
| `SUPABASE_JWT_SECRET` | Only if auth JWT used | **Secret** — from Render. (Legacy; frontend no longer relies on it.) |
| `FRONTEND_ORIGIN` | No | Defaults to `https://playvalor.app,https://playvalor.vercel.app` — fine as-is. |

Recover secret values from the **Render dashboard** (Environment tab) or your local
`apps/api/.env`. Do not regenerate `BACKEND_PRIVATE_KEY` — that wallet is registered
on-chain; a new key breaks reward signing until re-registered.

## Step 6 — Deploy + generate a URL
1. Deploy (auto-triggers on the service). Watch the build logs.
2. Service → **Settings → Networking → Generate Domain** → gives a `*.up.railway.app` URL
   (or attach a custom domain / point `api.playvalor.app` at it to avoid future URL churn).

## Step 7 — Verify on the new URL
```bash
BASE="https://<your>.up.railway.app"
curl -s -o /dev/null -w "health   %{http_code}\n"  "$BASE/health"          # 200
curl -s -o /dev/null -w "ready    %{http_code}\n"  "$BASE/health/ready"    # 200 = DB reachable (new endpoint)
curl -s -o /dev/null -w "players  %{http_code}\n"  "$BASE/players"         # 200 with your migrated data
```
`/health/ready` (added in this migration) does a real `SELECT 1` — a 200 here proves the
DB copy is live, a 503 means the DB isn't wired up.

## Step 8 — Repoint everything at the new URL
- **Vercel** → frontend project → env `NEXT_PUBLIC_API_URL` = new URL → **redeploy**.
- **GitHub → Settings → Secrets and variables → Actions** → update `API_URL` secret.
  (Both workflows now read only this secret; no hardcoded host remains.)
- **UptimeRobot** → point the monitor at **`$BASE/health/ready`** (not `/health`) so it
  detects DB death, and it no longer needs to fight sleep. Optional: pause it entirely
  since Railway Hobby doesn't sleep.

## Step 9 — Soak, then decommission
1. Play through the app on the new URL for ~a day; watch Railway logs + the consistency
   cron (it emails on drift).
2. **Only then** tear down Render + Neon (and the dead Supabase project). They are your
   rollback until you're confident — do not delete them first.

---

## Rollback
If anything looks wrong after Step 8: set `NEXT_PUBLIC_API_URL` back to the Render URL,
revert the `API_URL` Actions secret, redeploy the frontend. Render + Neon are untouched
until Step 9, so this is instant.

## What changed in the repo for this migration
- `apps/api/src/handlers/mod.rs`: added `GET /health/ready` (DB-aware readiness; `/health`
  stays shallow so a DB blip can't restart-loop the process).
- `.github/workflows/keep-alive.yml`: removed the hardcoded Render URL; now reads only the
  `API_URL` secret and is an optional backstop on a non-sleeping host.

# Valor

A Web3 real-time 1v1 stat-duel SHOOTER built on [GoodDollar](https://gooddollar.org) + [Celo](https://celo.org). One verified human. One warrior. Forever.

Players verify their identity via GoodDollar, choose a character class, and enter a 3D arena where two fighters stand at range and trade shots. The only player skill is dodge timing — better guns mean more power. Gun economy drives the marketplace. Earn XP and rank up, buy guns/ammo/attachments from the on-chain marketplace using G$ — with no gas fees required.

**Live**: https://playvalor.vercel.app  
**API**: https://valor-production.up.railway.app  
**Contracts**: Celo Mainnet · [Celoscan](https://celoscan.io)  
**Domain**: [playvalor.app](https://playvalor.vercel.app ) (custom domain — configure DNS to point to Vercel)

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌────────────────┐
│   Next.js 15 App    │────▶│   Rust / Actix-web API   │────▶│  PostgreSQL    │
│   (Vercel)          │     │   (Railway)               │     │  (Supabase)    │
└─────────────────────┘     └──────────────────────────┘     └────────────────┘
         │                              │
         │ Privy auth                   │ Celo RPC (forno.celo.org)
         │ wagmi v3                     │ GoodDollar SDK
         ▼                              ▼
   ┌───────────┐                 ┌─────────────────┐
   │ GoodDollar│                 │  Celo Mainnet   │
   │ Identity  │                 │  Smart Contracts│
   └───────────┘                 └─────────────────┘
```

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 15 App Router, Tailwind CSS v4, Framer Motion, Three.js / React Three Fiber |
| Auth | [Privy](https://privy.io) (email + social + wallet), wagmi v3 |
| Backend | Rust, Actix-web 4, SQLx, Tokio |
| Database | PostgreSQL via Supabase (PgBouncer transaction-mode pooler) |
| Hosting | Vercel (frontend) + Railway (API + cron) |
| Chain | Celo Mainnet (chainId 42220) |
| Identity | GoodDollar Citizen SDK (ERC-725 whitelist) |
| Rewards | GoodDollar Engagement Rewards SDK |
| Contracts | Foundry (Forge), OpenZeppelin UUPS upgradeable, ERC1155 + ERC677 |

---

## Smart Contracts (Celo Mainnet)

All contracts are UUPS upgradeable proxies, owned by the deployer EOA. Verified on Celoscan.

| Contract | Proxy Address | Purpose |
|----------|--------------|---------|
| `ValorItems` | `0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe` | ERC1155 NFT — one token type per item |
| `ValorMarketplace` | `0x95D167f569cf05C967C0432e3123baeac5D8d78D` | G$ purchases via permit relay; mints item NFTs |
| `ValorRewardPool` | `0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4` | Holds G$ for rank-up + daily claim rewards |
| `ValorGameRecord` | `0xd4ec6dB553E206cdf741448F94bD3B02D81c8571` | Immutable on-chain log of battles, rank-ups, character claims |

### Gasless Purchase Flow

Players never need CELO to buy items. The full flow:

1. **Frontend** reads the player's current G$ permit nonce on-chain
2. **Player signs** an EIP-2612 permit off-chain (no gas, no popup beyond signing)
3. **Frontend sends** `{ wallet, deadline, v, r, s }` to `POST /items/:id/purchase-relay`
4. **Backend** calls `ValorMarketplace.purchaseWithPermit(buyer, itemId, deadline, v, r, s)` — paying CELO gas from the relayer wallet
5. **Contract** pulls G$ from buyer via `permit` + `transferFrom`, then mints the ERC1155 item NFT to the buyer
6. **Backend** records inventory in the database and returns `{ tx_hash }`

---

## Game Mechanics

### Characters

Three classes with base stats plus ±3 wallet-seeded variance per player:

| Class | ATK | DEF | SPD | Special |
|-------|-----|-----|-----|---------|
| Berserker | 16 | 7 | 9 | Berserker Rage — 3× base damage |
| Sentinel | 9 | 16 | 7 | Iron Fortress — absorbs next hit, reflects 50% |
| Phantom | 12 | 7 | 15 | Shadow Strike — always first, bypasses defence |

One character per wallet. Class is permanent. Username is editable at any time.

### Combat — Stat-Duel Shooter

Two fighters at range trade shots in a 3D arena. Dodge timing is the player skill.

- **6 animation states**: idle, fire, stagger, dodge, death, victory
- **Projectile-based** (not hitscan) — travelling bullets that can be dodged
- **CombatSim** resolves: fire cadence from gun `fireRate`, accuracy roll, dodge i-frames, crit chance
- **Campaign**: 15 levels across 3 zones (Ashfall, Proving Ground, The Rift), bosses every 5th level
- **Endless mode** after level 15 with weekly leaderboards
- Bot fights: client runs CombatSim → server validates result
- Player challenges: fully server-side with a random seed
- Equipped guns determine fire rate, damage, accuracy; ammo/attachments modify stats; boosters 2× XP

### Ranks & XP

`Bronze → Silver → Gold → Platinum → Diamond`

| Event | XP |
|-------|----|
| Win | +50 to +104 (scales per campaign level) |
| Loss | +15 to +34 (scales per campaign level) |
| Rank threshold | 1,000 XP (exactly 15 wins at max level) |

XP resets to the remainder on rank-up. Rank-up triggers a G$ reward from `ValorRewardPool`.

### Decay

| Threshold | Consequence |
|-----------|-------------|
| 48 h inactivity | Warning shown |
| 72 h inactivity | Rank downgraded |
| Reset by | Battle, mission collect, or daily check-in |
| Freeze | Equip a Shield item — pauses decay for 7 days |

### Items

#### Guns

| Gun | Price | Notes |
|-----|-------|-------|
| Standard Sidearm | Free | Starter weapon |
| Compact SMG | 150 G$ | Fast fire rate, low damage |
| Assault Rifle | 400 G$ | Balanced |
| Marksman Rifle | 900 G$ | High damage, slow fire rate |
| Valor Prototype | 2,000 G$ | Best-in-class stats |

#### Ammo Types

| Ammo | Effect |
|------|--------|
| Hollow Point | +20% DMG |
| Armor Piercing | +10% DMG, +5% crit |
| Tracer | +8% ACC, +30 RPM |
| Incendiary | 3 HP/s burn DOT |

#### Attachments

4 slots (barrel, optic, grip, magazine) x 2 options each = 8 attachments total.

#### Other Items

| Category | Effect |
|----------|--------|
| Booster | 2x XP from battles while equipped (XP Booster, Elite Booster) |
| Shield | +DEF while equipped; can also freeze decay for 7 days |
| Legacy weapons | Iron Sword, Steel Blade, Void Edge — still exist from the melee era |

All 25 items are registered on-chain (`on_chain_id` 1-25). Purchased with G$ via the in-game marketplace. Items are ERC1155 NFTs on-chain, mirrored in the database for fast reads.

### GoodDollar Integration

- **Identity gate**: Players must be GoodDollar-verified humans to create a character (ERC-725 whitelist check via `@goodsdks/citizen-sdk`). A full-screen gate blocks all navigation until verification passes. The flow: wallet check → if already whitelisted, advance immediately; if not, an inline "Complete Verification" panel redirects to GoodDollar face verification in the same tab, with an "Already verified — continue" re-check button on return. A sign-out option is available throughout.
- **Daily G$ claim**: The in-app Daily Check-In triggers GoodDollar's UBI `ClaimSDK.claim()` directly — G$ flows from the GoodDollar protocol to the player's wallet. Gas top-up (if needed) and the claim itself are handled in two wallet prompts, surfaced with live step feedback in the UI.
- **Engagement Rewards**: Battle wins can earn additional G$ via the GoodDollar Engagement Rewards SDK (EIP-712 dual-signature: backend signs `AppClaim`, user signs `Claim`, frontend calls `nonContractAppClaim` on-chain). Requires portal approval — see *GoodDollar App Registration* below.
- **Marketplace**: All purchases use G$ on Celo — gasless via EIP-2612 permit relay
- **Rank rewards**: G$ distributed from `ValorRewardPool` on each rank-up

### Navigation

- **Home** (`/`) — character portrait + action cards
- **Fight** (`/battle`) — mode select: Campaign, Challenge a Player, Live PvP
- **Campaign** — CampaignSelect → `/fight?level=N` (3D combat arena)
- **Post-fight** — Retry (same level), Next Level (on win), Return Home

---

## Local Development

### Prerequisites

- Node.js 22+
- Rust 1.80+ (`rustup update stable`)
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- PostgreSQL 15+ (or a Supabase project)
- `psql` CLI

### 1. Clone and install

```bash
git clone https://github.com/MarvyNwaokobia/Valor.git
cd Valor
npm install
```

### 2. Set up the API

```bash
cd apps/api

# Copy and fill in environment variables
cp .env.example .env

# Run database migrations
psql $DATABASE_URL < migrations/init.sql
psql $DATABASE_URL < migrations/add_chain_tx_columns.sql
psql $DATABASE_URL < migrations/fix_decimal_columns.sql
psql $DATABASE_URL < migrations/add_gdollar_ledger.sql

# Build and run
cargo run
```

API starts on `http://localhost:8080`.

### 3. Set up the frontend

```bash
cd apps/web
cp .env.local.example .env.local   # fill in all NEXT_PUBLIC_* vars
npm run dev
```

Frontend starts on `http://localhost:3000`.

### 4. Contracts (optional — mainnet contracts are already deployed)

```bash
cd contracts
forge build
forge test
```

---

## Environment Variables

### `apps/web/.env.local`

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | ✅ | Privy app ID from [dashboard.privy.io](https://dashboard.privy.io) |
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `NEXT_PUBLIC_GOODDOLLAR_ENV` | ✅ | `production` or `staging` |
| `NEXT_PUBLIC_VALOR_APP_ADDRESS` | ✅ | Wallet registered on GoodDollar Engagement Rewards |
| `NEXT_PUBLIC_MARKETPLACE_CONTRACT` | ✅ | `ValorMarketplace` proxy address |
| `NEXT_PUBLIC_ITEMS_CONTRACT` | ✅ | `ValorItems` proxy address |
| `NEXT_PUBLIC_REWARD_POOL_CONTRACT` | ✅ | `ValorRewardPool` proxy address |
| `NEXT_PUBLIC_GAME_RECORD_CONTRACT` | ✅ | `ValorGameRecord` proxy address |
| `NEXT_PUBLIC_GD_REGISTRATION_TX` | — | TX hash of the GoodDollar app registration |

### `apps/api/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `BACKEND_PRIVATE_KEY` | ✅ | Relayer wallet private key — pays CELO gas for purchases + signs GoodDollar EIP-712 claims |
| `GAME_RECORD_CONTRACT` | ✅ | `ValorGameRecord` proxy address — enables on-chain battle/rank logging |
| `MARKETPLACE_CONTRACT` | ✅ | `ValorMarketplace` proxy address — enables gasless purchase relay |
| `CELO_RPC_URL` | ✅ | Celo RPC (default: `https://forno.celo.org`) |
| `VALOR_APP_ADDRESS` | ✅ | Public address of `BACKEND_PRIVATE_KEY` |
| `DECAY_CRON_SECRET` | ✅ | Shared secret for the `POST /decay/run` cron endpoint |
| `FRONTEND_ORIGIN` | — | Comma-separated allowed CORS origins |
| `RUST_LOG` | — | Log level (default: `info`) |
| `BIND_ADDR` | — | Bind address (default: `0.0.0.0:8080`) |
| `RANK_POOL_SILVER` | — | GoodCollective UBI pool address for Silver rank rewards |
| `RANK_POOL_GOLD` | — | GoodCollective UBI pool address for Gold rank rewards |
| `RANK_POOL_PLATINUM` | — | GoodCollective UBI pool address for Platinum rank rewards |
| `RANK_POOL_DIAMOND` | — | GoodCollective UBI pool address for Diamond rank rewards |
| `G_TOKEN_CONTRACT` | — | G$ SuperToken address on Celo (defaults to the known mainnet address) — used to relay player-initiated transfer-outs |
| `ADMIN_WALLETS` | — | Comma-separated wallet addresses allowed to sign into `/admin` |
| `ADMIN_JWT_SECRET` | — | Signing secret for short-lived admin session tokens (separate from `SUPABASE_JWT_SECRET`) |

### `contracts/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | Deploy only | Wallet with CELO for gas (prefixed `0x`) |
| `BACKEND_SIGNER_ADDRESS` | Deploy only | Address corresponding to `BACKEND_PRIVATE_KEY` |
| `CELO_RPC_URL` | Deploy only | Celo RPC URL |
| `CELOSCAN_API_KEY` | Deploy only | For Celoscan verification |

---

## API Reference

### Players

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/players` | Create player |
| `GET` | `/players` | List all players (leaderboard) |
| `GET` | `/players/search?q=` | Search players by username |
| `GET` | `/players/:wallet` | Get player profile |
| `PATCH` | `/players/:wallet` | Update username / customization |
| `GET` | `/players/:wallet/inventory` | Get inventory |
| `PATCH` | `/players/:wallet/inventory/:itemId` | Toggle equip |
| `GET` | `/players/:wallet/battles` | Battle history |
| `GET` | `/players/:wallet/achievements` | Achievement list |
| `POST` | `/players/:wallet/achievements/check` | Refresh achievement state |
| `POST` | `/players/:wallet/daily-claim` | Daily check-in |
| `GET` | `/players/:wallet/daily-claim-status` | Check if claimable today |
| `POST` | `/players/:wallet/decay-check` | Run decay check for this player |
| `POST` | `/players/:wallet/freeze-decay` | Consume a Shield to freeze decay 7 days |
| `GET` | `/players/:wallet/username-available/:username` | Check username availability |
| `GET` | `/players/:wallet/ledger-summary` | G$ earned (UBI/gameplay) + spent breakdown for the Bank page |
| `POST` | `/players/:wallet/transfer` | Transfer G$ out to any wallet (player-signed permit, relayed) |
| `GET` | `/relay-address` | Backend relay wallet's address (needed as the transfer permit's spender) |

### Battles

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/battles/bot` | Fight a bot (server-authoritative) |
| `POST` | `/battles/challenge` | Challenge another player |
| `POST` | `/battles/fight/complete` | Real-time fight reward (campaign + quick fight) |
| `POST` | `/battles/pvp/complete` | PvP reward (server-authoritative) |

### Endless Mode

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/endless/score` | Get player's endless mode score |
| `POST` | `/endless/score` | Submit endless mode score |
| `GET` | `/endless/leaderboard` | Weekly endless mode leaderboard |

### Items

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/items` | All marketplace items |
| `POST` | `/items/:id/purchase` | Record an admin/internal inventory grant |
| `POST` | `/items/:id/purchase-relay` | Gasless purchase — relays EIP-2612 permit on-chain |

### Rewards & Identity

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rewards/sign-claim` | Backend signs a GoodDollar AppClaim EIP-712 message |
| `GET` | `/identity/verify/:wallet` | Check GoodDollar identity status |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/decay/run` | Trigger decay sweep (requires `x-cron-secret` header) |
| `GET` | `/health` | Health check |
| `POST` | `/admin/login` | Wallet-signature login (checked against `ADMIN_WALLETS`) — issues a short-lived admin JWT |
| `GET` | `/admin/stats?season_id=` | Season (or all-time) player/G$ volume stats — requires admin bearer token |
| `GET` | `/admin/seasons` | List seasons — requires admin bearer token |
| `POST` | `/admin/seasons` | Start a new season, closing any currently-open one — requires admin bearer token |
| `POST` | `/admin/seasons/:id/end` | End a season — requires admin bearer token |

### WebSocket

| Path | Description |
|------|-------------|
| `WS /ws/battle` | Live PvP battle channel |

---

## Deployment

### Contracts

```bash
cd contracts

# 1. Deploy all four contracts
source .env
forge script script/Deploy.s.sol \
  --rpc-url $CELO_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $CELOSCAN_API_KEY

# 2. Register items on-chain and list them in the marketplace
ITEMS_CONTRACT=<address> MARKETPLACE_CONTRACT=<address> \
  forge script script/Setup.s.sol --rpc-url $CELO_RPC_URL --broadcast

# 2b. Register new items (guns, ammo, attachments) after initial setup
ITEMS_CONTRACT=<address> MARKETPLACE_CONTRACT=<address> \
  forge script script/RegisterNewItems.s.sol --rpc-url $CELO_RPC_URL --broadcast

# 3. Copy proxy addresses into apps/web/.env.local and Railway env vars
```

### API (Railway)

The API deploys via the Railway GitHub integration using `apps/api/Dockerfile`. To force a rebuild from local source:

```bash
cd apps/api
railway up --detach
```

Required Railway env vars: `DATABASE_URL`, `BACKEND_PRIVATE_KEY`, `GAME_RECORD_CONTRACT`, `MARKETPLACE_CONTRACT`, `CELO_RPC_URL`, `VALOR_APP_ADDRESS`, `DECAY_CRON_SECRET`.

After deploying to a fresh database, run the migrations in order:

```bash
railway variables --service Postgres --json   # get DATABASE_PUBLIC_URL
psql $DATABASE_PUBLIC_URL < migrations/init.sql               # 001 initial schema
psql $DATABASE_PUBLIC_URL < migrations/add_chain_tx_columns.sql  # 002 RLS + chain tx columns
psql $DATABASE_PUBLIC_URL < migrations/fix_decimal_columns.sql   # 003 fix decimal types
psql $DATABASE_PUBLIC_URL < migrations/add_gdollar_ledger.sql    # 004 G$ ledger + seasons
```

Planned migrations (not yet in `migrations/` — apply when implemented):

| # | Migration | Purpose |
|---|-----------|---------|
| 004 | guns | Gun items, fire rate, damage, accuracy columns |
| 005 | pve_level | Campaign level tracking per player |
| 006 | endless | Endless mode scores + weekly leaderboard |
| 007 | remove_melee | Drop legacy melee-specific columns |
| 008 | ammo_attachments | Ammo types + attachment slots |

### Frontend (Vercel)

Deploys automatically on push to `main`. Set all `NEXT_PUBLIC_*` env vars in the Vercel dashboard.

### GoodDollar App Registration

Valor is registered on the GoodDollar Engagement Rewards contract at `engagement-rewards.vercel.app`.

| Field | Value |
|-------|-------|
| App / Signer Address | `0x43a5BA0da132b21bdACfBc4392b72EeBaF6f2D82` |
| Reward Receiver | `0x12a3F1f4...` (ValorRewardPool) |
| User+Inviter % | 100% (all rewards flow to players) |
| User % | 70% (70% to battling player, 30% to their inviter) |
| Status | Pending approval |

Once approved, set `NEXT_PUBLIC_VALOR_APP_ADDRESS` (frontend) and `VALOR_BACKEND_SIGNER_KEY` (API) to the registered wallet. The `useValorEngagementRewards` hook and the `/rewards/sign-claim` backend endpoint are already wired — no code changes needed after approval.

---

## Known Limitations / Pre-launch TODOs

| Area | Status | Notes |
|------|--------|-------|
| Daily G$ UBI claim | Live | `ClaimSDK.claim()` wired in-app. Players claim GoodDollar UBI directly from the Daily Check-In button. |
| Engagement Rewards | Pending approval | App submitted at `engagement-rewards.vercel.app`. Once approved, battle-win G$ distributions go live automatically. |
| Identity gate | Live | Full-screen GoodDollar whitelist check. Already-whitelisted wallets pass instantly. Unverified wallets see an inline "Complete Verification" panel that redirects to GoodDollar face verification (same tab). Sign-out button available throughout. Nav is inaccessible until verified. |
| Ammo/attachment equip | Not wired | `Loadout.ts` has `resolveGunStats` but CombatSim doesn't call it yet — ammo/attachment bonuses are defined but not applied in combat. |
| Campaign level UX | Incomplete | No level context shown during fights — player doesn't see which level/zone they're in while fighting. |
| Per-level arena | Not implemented | All fights use the same stylized arena regardless of campaign zone. |
| GoodCollective rank pools | Not deployed | `RANK_POOL_*` env vars are placeholders. Deploy pools on `goodcollective.xyz` and grant `MANAGER_ROLE` to the backend signer to activate passive UBI drip for Silver+ ranks. |
| On-chain character claim | Deferred | `character_claim_tx` column exists and `ChainBadge` renders it, but character minting is not yet triggered in the onboarding flow. |
| Mission signature auth | Not implemented | `x-wallet` header is trusted without EIP-712 sign. Acceptable for MVP. |
| Inventory IDOR | Not implemented | Inventory endpoints don't require wallet signature. Acceptable for MVP. |
| RewardPool funding | Manual | Fund `ValorRewardPool` with G$ before rank-up rewards can be distributed. |
| GLB model assignment | Intentional | Sentinel class uses `phantom.glb`; Phantom class uses `sentinel.glb` — swap filenames in `CHARACTER_GLB` if this changes. |

---

## Project Structure

```
Valor/
├── apps/
│   ├── web/                      # Next.js 15 frontend (Vercel)
│   │   └── src/
│   │       ├── app/              # App Router — layout, pages, providers
│   │       ├── views/            # Page-level components (BattlePage, MarketplacePage, …)
│   │       ├── components/       # Feature components (battle/, marketplace/, warrior/, ui/)
│   │       │   └── marketplace/
│   │       │       └── GunIcons.tsx   # Gun icon components for the marketplace
│   │       ├── engine/
│   │       │   ├── combat/
│   │       │   │   ├── GunStats.ts    # Gun stat definitions + scaling
│   │       │   │   └── Loadout.ts     # Loadout resolution (gun + ammo + attachments)
│   │       │   ├── campaign/
│   │       │   │   └── levels.ts      # 15-level campaign definition (zones, bosses, XP)
│   │       │   └── sim/
│   │       │       └── CombatSim.ts   # Core combat simulation (fire cadence, dodge, crit)
│   │       ├── hooks/            # React hooks (useMarketplace, useBattle, useEngagementRewards, …)
│   │       ├── stores/           # Zustand state (player, inventory)
│   │       ├── lib/              # Constants, wagmi config, classes, GoodDollar SDK setup
│   │       ├── types/            # TypeScript types (database.ts, index.ts)
│   │       └── utils/            # Format helpers, decay utilities
│   └── api/                      # Rust / Actix-web backend (Railway)
│       ├── src/
│       │   ├── handlers/         # HTTP route handlers
│       │   ├── models/           # SQLx row types (Player, Item, Battle, …)
│       │   ├── services/         # Battle simulation, chain relay, rewards, rate limiter
│       │   └── utils.rs          # Wallet normalisation
│       ├── migrations/           # SQL migration files
│       └── Dockerfile
├── contracts/                    # Foundry smart contracts
│   ├── src/
│   │   ├── ValorItems.sol        # ERC1155 item NFTs
│   │   ├── ValorMarketplace.sol  # G$ permit relay purchase + mint
│   │   ├── ValorRewardPool.sol   # G$ rank-up and daily rewards
│   │   ├── ValorGameRecord.sol   # Immutable on-chain game event log
│   │   └── interfaces/
│   │       └── IGoodDollar.sol
│   ├── script/
│   │   ├── Deploy.s.sol          # Deploy all contracts
│   │   ├── Setup.s.sol           # Register + list items
│   │   ├── RegisterNewItems.s.sol # Register guns, ammo, attachments
│   │   └── UpgradeMarketplace.s.sol
│   └── test/
│       ├── ValorItems.t.sol
│       ├── ValorMarketplace.t.sol
│       └── ValorRewardPool.t.sol
├── packages/                     # Shared TypeScript types
└── scripts/
    └── register-gooddollar.mjs  # One-time GoodDollar app registration
```

---

## License

MIT

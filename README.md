# Valor

A Web3 character-based fighting game built on [GoodDollar](https://gooddollar.org) + [Celo](https://celo.org). One verified human. One warrior. Forever.

Players verify their identity via GoodDollar, choose a character class, battle bots and other players to earn XP and rank up, and buy gear from the on-chain marketplace using G$ — with no gas fees required.

**Live**: https://playvalor.vercel.app  
**API**: https://valor-production.up.railway.app  
**Contracts**: Celo Mainnet · [Celoscan](https://celoscan.io)

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

### Battle

- 5 rounds max. Each round: Attack / Defend / Special (once per battle)
- **Damage**: `base(20) ± 20% variance × (1 + (ATK − DEF) × 0.01) × defMult(0.5 if defending)`
- Special deals 2× base damage (40 base) and bypasses the defender's defence multiplier
- Bot fights: client submits moves → server runs authoritative simulation
- Player challenges: fully server-side with a random seed
- Equipped weapons boost ATK; shields boost DEF; boosters 2× XP

### Ranks & XP

`Bronze → Silver → Gold → Platinum → Diamond`

| Event | XP |
|-------|----|
| Win | +100 |
| Loss | +30 |
| Rank threshold | 1000 XP |

XP resets to the remainder on rank-up. Rank-up triggers a G$ reward from `ValorRewardPool`.

### Decay

| Threshold | Consequence |
|-----------|-------------|
| 48 h inactivity | Warning shown |
| 72 h inactivity | Rank downgraded |
| Reset by | Battle, mission collect, or daily check-in |
| Freeze | Equip a Shield item — pauses decay for 7 days |

### Items

| Category | Effect |
|----------|--------|
| Weapon | +ATK while equipped |
| Shield | +DEF while equipped; can also freeze decay for 7 days |
| Booster | 2× XP from battles while equipped |
| Cosmetic | Visual only |

Purchased with G$ via the in-game marketplace. Items are ERC1155 NFTs on-chain, mirrored in the database for fast reads.

### GoodDollar Integration

- **Identity gate**: Players must be GoodDollar-verified humans to create a character (ERC-725 whitelist check)
- **Engagement Rewards**: Daily check-in earns G$ once the app is approved by GoodDollar's team
- **Marketplace**: All purchases use G$ on Celo — gasless via permit relay
- **Rank rewards**: G$ distributed from `ValorRewardPool` on each rank-up

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
| `POST` | `/players/:wallet/rank-up` | Claim rank-up reward |
| `POST` | `/players/:wallet/freeze-decay` | Consume a Shield to freeze decay 7 days |
| `GET` | `/players/:wallet/username-available/:username` | Check username availability |

### Battles

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/battles/bot` | Fight a bot (server-authoritative) |
| `POST` | `/battles/challenge` | Challenge another player |

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

# 3. Copy proxy addresses into apps/web/.env.local and Railway env vars
```

### API (Railway)

The API deploys via the Railway GitHub integration using `apps/api/Dockerfile`. To force a rebuild from local source:

```bash
cd apps/api
railway up --detach
```

Required Railway env vars: `DATABASE_URL`, `BACKEND_PRIVATE_KEY`, `GAME_RECORD_CONTRACT`, `MARKETPLACE_CONTRACT`, `CELO_RPC_URL`, `VALOR_APP_ADDRESS`, `DECAY_CRON_SECRET`.

After deploying to a fresh database, run the migrations:

```bash
railway variables --service Postgres --json   # get DATABASE_PUBLIC_URL
psql $DATABASE_PUBLIC_URL < migrations/init.sql
psql $DATABASE_PUBLIC_URL < migrations/add_chain_tx_columns.sql
psql $DATABASE_PUBLIC_URL < migrations/fix_decimal_columns.sql
```

### Frontend (Vercel)

Deploys automatically on push to `main`. Set all `NEXT_PUBLIC_*` env vars in the Vercel dashboard.

### GoodDollar App Registration

Valor is registered on the GoodDollar Engagement Rewards contract. The registration is a two-step process:

1. **Applied** (done): `applyApp()` was called on the GoodDollar Engagement Rewards contract  
   TX: `0x015015973be829fd461df506480fbc8a9bfe00c6085aff622024ba1ca151f569`

2. **Approved** (pending): GoodDollar's team must call `approve()` before daily G$ distributions go live.  
   Contact: `partnerships@gooddollar.org` or `#builders` on the GoodDollar Discord.

---

## Known Limitations / Pre-launch TODOs

| Area | Status | Notes |
|------|--------|-------|
| Daily G$ distribution | Pending | Waiting on GoodDollar `approve()`. Check-in resets decay only until approved. |
| Identity gate | Bypassed for testing | Currently set to `'skip'` mode in `gooddollar.ts`. Set back to `'verify'` before launch. |
| Character 3D customization | Deferred | `character_customization` JSON is saved but not yet applied to GLB mesh. Portrait images respect skin/hair. |
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

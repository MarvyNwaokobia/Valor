# Valor

A Web3 character-based fighting game built on [GoodDollar](https://gooddollar.org) + [Celo](https://celo.org). One verified human. One warrior. Forever.

Players verify their identity via GoodDollar, choose a character class, battle bots and other players to earn XP and rank up, and buy gear from the on-chain marketplace using G$.

**Live**: https://playvalor.vercel.app  
**API**: https://valor-production.up.railway.app  
**Contracts**: Celo Mainnet (verified on [Celoscan](https://celoscan.io))

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│   Next.js 15 App    │────▶│   Rust / Actix-web API   │────▶│  PostgreSQL     │
│   (Vercel)          │     │   (Railway)               │     │  (Supabase)     │
└─────────────────────┘     └──────────────────────────┘     └─────────────────┘
         │                              │
         │ Privy auth                   │ Celo RPC
         │ wagmi v3 wallet              │ GoodDollar SDK
         ▼                              ▼
   ┌───────────┐                 ┌─────────────┐
   │ GoodDollar│                 │ Celo Mainnet│
   │ Identity  │                 │ Contracts   │
   └───────────┘                 └─────────────┘
```

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 15 App Router, Tailwind, Framer Motion, Three.js |
| Auth | [Privy](https://privy.io) (email + wallet), wagmi v3 |
| Backend | Rust, Actix-web, SQLx, Tokio |
| Database | PostgreSQL via Supabase pooler (PgBouncer) |
| Hosting | Vercel (frontend) + Railway (API + cron) |
| Chain | Celo Mainnet |
| Identity | GoodDollar Citizen SDK (ERC-725 whitelist) |
| Rewards | GoodDollar Engagement Rewards SDK |
| Contracts | Foundry (Forge), OpenZeppelin, ERC1155 + ERC677 |

---

## Smart Contracts (Celo Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| `ValorItems` | `0x4934d73415ccFb3A79c6c83CD73358f493Cdd974` | ERC1155 NFT — one token per item type |
| `ValorMarketplace` | `0x90C57700474387c65EF3F0b1da0300a6e7B436c0` | Accepts G$ via `transferAndCall`, mints item NFTs |
| `ValorRewardPool` | `0xD9F50d8F5Be81CA215Ee23cD668738793914Ce15` | Holds G$ for rank-up + daily claim rewards |

**Purchase flow**: Player calls `G$.transferAndCall(marketplace, price, itemId)` → Marketplace receives G$, mints NFT to buyer in one transaction.

All three contracts are verified on Celoscan.

---

## Game Mechanics

### Characters
Three classes, each with base stats + wallet-seeded ±3 variance:

| Class | ATK | DEF | SPD | Special |
|-------|-----|-----|-----|---------|
| Berserker | 16 | 7 | 9 | Bloodlust |
| Sentinel | 9 | 16 | 7 | Iron Bulwark |
| Phantom | 12 | 7 | 15 | Shadow Step |

One character per wallet. Class is permanent. Username is editable.

### Battle
- 5 rounds. Each round: choose Attack / Defend / Special
- Damage formula: `base(20 or 40) ± 20% variance × (1 + (ATK-DEF)×0.01) × defMult(0.5 if defending)`
- Bot fights: server-side authoritative simulation (client submits moves, server runs it)
- Player challenges: fully server-side with random seed
- Equipped weapons boost ATK; shields boost DEF; boosters double XP earned

### Ranks & XP
`Bronze → Silver → Gold → Platinum → Diamond`

- Win: +100 XP | Loss: +30 XP
- 1000 XP = rank up (XP resets to remainder)
- Rank-up triggers a G$ reward from `ValorRewardPool`

### Decay
- 48h inactivity → Warning
- 72h inactivity → Rank downgrade
- Reset by: battling, completing a mission, or daily check-in
- Freeze with a Protection Shield item (7 days)

### Items
| Category | Effect |
|----------|--------|
| Weapon | +ATK stat while equipped |
| Shield | +DEF stat while equipped; also usable to freeze decay 7 days |
| Booster | 2× XP earned from battles while equipped |
| Cosmetic | Visual only |

Purchased with G$ via the marketplace. Stored as ERC1155 NFTs on-chain, mirrored in the DB.

### GoodDollar Integration
- **Identity**: Players must be GoodDollar-verified humans to onboard
- **Engagement Rewards**: Daily check-in triggers a GoodDollar on-chain G$ reward (once app is approved)
- **Marketplace**: All purchases are G$ on Celo

---

## Local Development

### Prerequisites

- Node.js 22+
- Rust 1.80+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- PostgreSQL (or use Supabase)

### 1. Clone and install

```bash
git clone https://github.com/MarvyNwaokobia/Valor.git
cd Valor
npm install
```

### 2. Set up the API

```bash
cd apps/api
cp .env.example .env   # fill in DATABASE_URL and BACKEND_PRIVATE_KEY
cargo build
cargo run
```

API runs on `http://localhost:8080`. Run migrations:

```bash
psql $DATABASE_URL < migrations/init.sql
```

### 3. Set up the frontend

```bash
cd apps/web
cp .env.local.example .env.local   # fill in all NEXT_PUBLIC_* vars
npm run dev
```

Frontend runs on `http://localhost:3000`.

---

## Environment Variables

### `apps/web/.env.local`

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | ✅ | Privy app ID from dashboard.privy.io |
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API URL |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `NEXT_PUBLIC_GOODDOLLAR_ENV` | ✅ | `production` or `staging` |
| `NEXT_PUBLIC_VALOR_APP_ADDRESS` | ✅ | Wallet address registered on GoodDollar Engagement Rewards |
| `NEXT_PUBLIC_MARKETPLACE_CONTRACT` | ✅ | ValorMarketplace contract address |
| `NEXT_PUBLIC_ITEMS_CONTRACT` | ✅ | ValorItems contract address |
| `NEXT_PUBLIC_REWARD_POOL_CONTRACT` | ✅ | ValorRewardPool contract address |

### `apps/api/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `BACKEND_PRIVATE_KEY` | ✅ | Private key for signing GoodDollar EIP-712 AppClaim messages |
| `VALOR_APP_ADDRESS` | ✅ | Public address corresponding to BACKEND_PRIVATE_KEY |
| `DECAY_CRON_SECRET` | ✅ | Secret header value for the `/decay/run` endpoint |
| `CELO_RPC_URL` | ✅ | Celo RPC URL (e.g. `https://forno.celo.org`) |
| `RUST_LOG` | — | Log level (default: `info`) |
| `BIND_ADDR` | — | Bind address (default: `0.0.0.0:8080`) |
| `FRONTEND_ORIGIN` | — | Comma-separated allowed CORS origins |

### `contracts/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | Deploy only | Wallet with CELO for gas (prefixed `0x`) |
| `BACKEND_SIGNER_ADDRESS` | Deploy only | Address corresponding to `BACKEND_PRIVATE_KEY` |
| `CELO_RPC_URL` | Deploy only | Celo RPC URL |
| `CELOSCAN_API_KEY` | Deploy only | For contract verification |

---

## API Reference

### Players
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/players` | Create player |
| `GET` | `/players/:wallet` | Get player |
| `PATCH` | `/players/:wallet` | Update player |
| `GET` | `/players/:wallet/inventory` | Get inventory |
| `POST` | `/players/:wallet/inventory/:itemId/equip` | Toggle equip |
| `POST` | `/players/:wallet/daily-claim` | Daily check-in |
| `GET` | `/players/:wallet/daily-claim-status` | Check if claimable |
| `POST` | `/players/:wallet/freeze-decay` | Consume shield to freeze decay |

### Battles
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/battles/bot` | Fight a bot (server-authoritative) |
| `POST` | `/battles/challenge` | Challenge another player |
| `GET` | `/battles/:wallet/history` | Battle history |

### Leaderboard & Items
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/leaderboard` | Top 50 players |
| `GET` | `/items` | All marketplace items |
| `POST` | `/items/:id/purchase` | Record purchase after on-chain tx |

### Rewards & Admin
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rewards/sign-claim` | Backend signs GoodDollar AppClaim |
| `POST` | `/decay/run` | Trigger decay sweep (requires `x-cron-secret`) |

---

## Deployment

### Contracts

```bash
cd contracts

# 1. Deploy all three contracts
source .env
forge script script/Deploy.s.sol \
  --rpc-url $CELO_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $CELOSCAN_API_KEY

# 2. Register and list all 9 items
ITEMS_CONTRACT=<address> MARKETPLACE_CONTRACT=<address> \
  forge script script/Setup.s.sol --rpc-url $CELO_RPC_URL --broadcast

# 3. Copy the addresses into contracts/.env and apps/web/.env.local
```

### API (Railway)

The API deploys automatically on push to `main` via the Railway GitHub integration. Railway uses the `apps/api/Dockerfile`.

Railway services:
- `valor` — the Actix-web API
- `Postgres` — not used (DB is Supabase)
- `decay-cron` — runs `/decay/run` every 30 minutes

### Frontend (Vercel)

Deploys automatically on push to `main`. Make sure all `NEXT_PUBLIC_*` env vars are set in the Vercel dashboard.

### GoodDollar App Registration

Valor is registered on the GoodDollar Engagement Rewards contract. This is a two-step process:

1. **Apply** (done): `applyApp()` was called on `0x25db74CF4E7BA120526fd87e159CF656d94bAE43`  
   TX: `0x015015973be829fd461df506480fbc8a9bfe00c6085aff622024ba1ca151f569`

2. **Approve** (pending): GoodDollar's team must call `approve()` for the daily G$ rewards to go live.  
   Contact: `partnerships@gooddollar.org` or GoodDollar Discord `#builders`

---

## Known Limitations

| Area | Status | Notes |
|------|--------|-------|
| Daily G$ distribution | Pending | Waiting on GoodDollar `approve()`. Check-in currently resets decay only. |
| Character 3D customization | Deferred | GLB meshes are fixed; `character_customization` JSON is saved but not applied to the 3D model. SVG fallback respects customization. |
| Mission signature auth | Not implemented | `x-wallet` header is trusted without EIP-712 signature. |
| Inventory IDOR | Not implemented | Inventory endpoints don't require wallet signature. Acceptable for MVP. |
| RewardPool funding | Manual | `ValorRewardPool` must be funded with G$ before rank-up rewards can be distributed. Send G$ to `0xD9F50d8F5Be81CA215Ee23cD668738793914Ce15`. |

---

## Project Structure

```
Valor/
├── apps/
│   ├── web/                  # Next.js 15 frontend
│   │   ├── src/
│   │   │   ├── app/          # App Router pages and layouts
│   │   │   ├── views/        # Page-level components
│   │   │   ├── components/   # Feature components
│   │   │   ├── hooks/        # React hooks
│   │   │   ├── stores/       # Zustand state (player, inventory)
│   │   │   ├── lib/          # Constants, GoodDollar config, classes
│   │   │   ├── types/        # TypeScript types
│   │   │   └── utils/        # Decay, format helpers
│   └── api/                  # Rust / Actix-web backend
│       ├── src/
│       │   ├── handlers/     # HTTP route handlers
│       │   ├── models/       # SQLx row types
│       │   ├── services/     # Battle simulation, rewards, rate limiter
│       │   └── utils/        # Wallet validation
│       ├── migrations/       # init.sql (schema + seed data)
│       └── Dockerfile
├── contracts/                # Foundry project
│   ├── src/
│   │   ├── ValorItems.sol        # ERC1155 item NFTs
│   │   ├── ValorMarketplace.sol  # G$ purchase + mint
│   │   ├── ValorRewardPool.sol   # G$ rank-up rewards
│   │   └── interfaces/
│   │       └── IGoodDollar.sol
│   ├── script/
│   │   ├── Deploy.s.sol          # Deploy all contracts
│   │   └── Setup.s.sol           # Register + list items
│   └── test/
├── scripts/
│   └── register-gooddollar.mjs  # One-time GoodDollar registration
└── packages/                     # Shared TypeScript types
```

---

## License

MIT

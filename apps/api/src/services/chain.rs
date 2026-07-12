use ethers::{
    middleware::SignerMiddleware,
    prelude::abigen,
    providers::{Http, Provider},
    signers::{LocalWallet, Signer},
    types::{Address, H256, U256},
};
use std::{collections::HashMap, str::FromStr, sync::Arc, time::Duration};

abigen!(
    ValorGameRecord,
    r#"[
        function claimCharacter(address player, string characterClass, string characterName) external
        function recordBattle(bytes32 battleId, address winner, address loser, uint8 xpWinner, uint8 xpLoser, bool isBot) external
        function recordRankUp(address player, string newRank) external
    ]"#
);

abigen!(
    GoodCollectiveUBIPool,
    r#"[
        function addMember(address member) external
    ]"#
);

abigen!(
    ValorMarketplace,
    r#"[
        function purchaseWithPermit(address buyer, uint256 itemId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external
    ]"#
);

abigen!(
    ValorRewardPool,
    r#"[
        function distributeRankUpReward(address player, string newRank) external
        function distributeDailyClaim(address player) external
        function distributeReward(address player, uint256 amount, bytes32 ref) external
        function rewardRefUsed(bytes32 ref) external view returns (bool)
    ]"#
);

// Standard ERC20 + EIP-2612 permit — G$ itself implements this (same contract
// the frontend already signs permits against for marketplace checkout).
abigen!(
    GDollarToken,
    r#"[
        function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external
        function transferFrom(address from, address to, uint256 value) external returns (bool)
    ]"#
);

// Mainnet G$ SuperToken on Celo — matches apps/web/src/lib/constants.ts's G_TOKEN_ADDRESS.
const DEFAULT_G_TOKEN: &str = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

type ChainClient = SignerMiddleware<Provider<Http>, LocalWallet>;

#[derive(Clone)]
pub struct ChainWriter {
    contract:     Arc<ValorGameRecord<ChainClient>>,
    client:       Arc<ChainClient>,
    rank_pools:   HashMap<String, Address>,
    marketplace:  Option<Arc<ValorMarketplace<ChainClient>>>,
    reward_pool:  Option<Arc<ValorRewardPool<ChainClient>>>,
    g_token:      Arc<GDollarToken<ChainClient>>,
    // Serializes every state-changing tx from the signer. A fight-complete fires
    // several writes concurrently (recordBattle + a bounty/reward payout), and a
    // plain SignerMiddleware reads the *pending* nonce independently per tx — so
    // two racing writes grab the SAME nonce and the loser is rejected as
    // "replacement transaction underpriced". Holding this lock across each
    // broadcast means the next tx reads the nonce only after the previous is in
    // the mempool. Self-healing: the nonce is always re-read from chain, so a
    // failed send never leaves a local counter out of sync (unlike a nonce manager).
    tx_lock:      Arc<tokio::sync::Mutex<()>>,
}

impl ChainWriter {
    pub fn from_env() -> Option<Self> {
        let private_key   = std::env::var("BACKEND_PRIVATE_KEY").ok()?;
        let contract_addr = std::env::var("GAME_RECORD_CONTRACT").ok()?;
        let rpc_url = std::env::var("CELO_RPC_URL")
            .unwrap_or_else(|_| "https://forno.celo.org".to_string());

        let wallet: LocalWallet = private_key
            .trim_start_matches("0x")
            .parse::<LocalWallet>()
            .map_err(|e| tracing::warn!("ChainWriter: invalid key: {}", e))
            .ok()?
            .with_chain_id(42220u64);

        let provider = Provider::<Http>::try_from(rpc_url.as_str())
            .map_err(|e| tracing::warn!("ChainWriter: bad RPC URL: {}", e))
            .ok()?;

        let address: Address = contract_addr
            .parse()
            .map_err(|e| tracing::warn!("ChainWriter: bad contract addr: {}", e))
            .ok()?;

        let client = Arc::new(SignerMiddleware::new(provider, wallet));
        let contract = Arc::new(ValorGameRecord::new(address, client.clone()));

        // GoodCollective UBI pool addresses — optional
        let mut rank_pools = HashMap::new();
        for rank in ["Silver", "Gold", "Platinum", "Diamond"] {
            let key = format!("RANK_POOL_{}", rank.to_uppercase());
            if let Ok(addr) = std::env::var(&key)
                .and_then(|v| v.parse::<Address>().map_err(|_| std::env::VarError::NotPresent))
            {
                rank_pools.insert(rank.to_string(), addr);
                tracing::info!("Rank pool {} → {:?}", rank, rank_pools[rank]);
            }
        }

        // Marketplace contract — optional (relay purchases disabled if unset)
        let marketplace = std::env::var("MARKETPLACE_CONTRACT")
            .ok()
            .and_then(|v| v.parse::<Address>().ok())
            .map(|addr| {
                tracing::info!("Marketplace relay enabled → {:?}", addr);
                Arc::new(ValorMarketplace::new(addr, client.clone()))
            });

        // Reward pool — optional (distributions skipped if unset)
        let reward_pool = std::env::var("REWARD_POOL_CONTRACT")
            .ok()
            .and_then(|v| v.parse::<Address>().ok())
            .map(|addr| {
                tracing::info!("Reward pool enabled → {:?}", addr);
                Arc::new(ValorRewardPool::new(addr, client.clone()))
            });

        let g_token_addr: Address = std::env::var("G_TOKEN_CONTRACT")
            .unwrap_or_else(|_| DEFAULT_G_TOKEN.to_string())
            .parse()
            .map_err(|e| tracing::warn!("ChainWriter: bad G_TOKEN_CONTRACT: {}", e))
            .ok()?;
        let g_token = Arc::new(GDollarToken::new(g_token_addr, client.clone()));

        tracing::info!("ChainWriter ready — game_record={}", contract_addr);
        Some(Self { contract, client, rank_pools, marketplace, reward_pool, g_token, tx_lock: Arc::new(tokio::sync::Mutex::new(())) })
    }

    pub async fn claim_character(
        &self,
        player: Address,
        class: String,
        name: String,
    ) -> Option<H256> {
        let _tx = self.tx_lock.lock().await;
        match self.contract.claim_character(player, class, name).send().await {
            Ok(pending) => {
                let hash = pending.tx_hash();
                tracing::info!("claimCharacter on-chain: {:?}", hash);
                Some(hash)
            }
            Err(e) => {
                tracing::warn!("claimCharacter chain write failed: {}", e);
                None
            }
        }
    }

    pub async fn record_battle(
        &self,
        battle_id: [u8; 32],
        winner: Address,
        loser: Address,
        xp_winner: u8,
        xp_loser: u8,
        is_bot: bool,
    ) -> Option<H256> {
        let _tx = self.tx_lock.lock().await;
        match self
            .contract
            .record_battle(battle_id, winner, loser, xp_winner, xp_loser, is_bot)
            .send()
            .await
        {
            Ok(pending) => {
                let hash = pending.tx_hash();
                tracing::info!("recordBattle on-chain: {:?}", hash);
                Some(hash)
            }
            Err(e) => {
                tracing::warn!("recordBattle chain write failed: {}", e);
                None
            }
        }
    }

    pub async fn record_rank_up(&self, player: Address, rank: String) -> Option<H256> {
        let _tx = self.tx_lock.lock().await;
        match self.contract.record_rank_up(player, rank).send().await {
            Ok(pending) => {
                let hash = pending.tx_hash();
                tracing::info!("recordRankUp on-chain: {:?}", hash);
                Some(hash)
            }
            Err(e) => {
                tracing::warn!("recordRankUp chain write failed: {}", e);
                None
            }
        }
    }

    pub async fn enroll_in_rank_pool(&self, player: Address, rank: &str) -> Option<H256> {
        let pool_addr = self.rank_pools.get(rank)?;
        let pool = GoodCollectiveUBIPool::new(*pool_addr, self.client.clone());
        let _tx = self.tx_lock.lock().await;
        match pool.add_member(player).send().await {
            Ok(pending) => {
                let hash = pending.tx_hash();
                tracing::info!("enrollRankPool {} → {:?}", rank, hash);
                Some(hash)
            }
            Err(e) => {
                tracing::warn!("enrollRankPool {} failed: {}", rank, e);
                None
            }
        }
    }

    /// Distributes a rank-up G$ reward from the ValorRewardPool to the player's wallet.
    /// Returns Ok(true) on success, Ok(false) if pool not configured, Err on failure.
    pub async fn distribute_rank_up_reward(&self, player: Address, rank: String) -> Result<bool, String> {
        let pool = match &self.reward_pool {
            Some(p) => p,
            None => return Ok(false),
        };
        let _tx = self.tx_lock.lock().await;
        pool.distribute_rank_up_reward(player, rank.clone())
            .send()
            .await
            .map_err(|e| format!("distributeRankUpReward failed: {}", e))?
            .await
            .map_err(|e| format!("distributeRankUpReward tx failed: {}", e))?;
        tracing::info!("distributeRankUpReward: {} → {}", player, rank);
        Ok(true)
    }

    /// Pays a one-time G$ bounty (first-clear reward, competition payout) from the
    /// ValorRewardPool. `amount_g` is whole G$; `ref` is an idempotency key so the
    /// same bounty can never pay twice on-chain (a duplicate call reverts).
    /// Returns Ok(true) on success, Ok(false) if the pool isn't configured.
    pub async fn distribute_reward(&self, player: Address, amount_g: u64, reference: [u8; 32]) -> Result<bool, String> {
        let pool = match &self.reward_pool {
            Some(p) => p,
            None => return Ok(false),
        };
        // G$ has 18 decimals; amount_g is whole tokens.
        let amount = U256::from(amount_g) * U256::exp10(18);
        let _tx = self.tx_lock.lock().await;
        pool.distribute_reward(player, amount, reference)
            .send()
            .await
            .map_err(|e| format!("distributeReward failed: {}", e))?
            .await
            .map_err(|e| format!("distributeReward tx failed: {}", e))?;
        tracing::info!("distributeReward: {} +{} G$ (ref {})", player, amount_g, hex::encode(reference));
        Ok(true)
    }

    /// Reads the on-chain idempotency flag for a bounty `ref`. `true` means that ref
    /// has already paid out on-chain, so a re-attempt would revert (`RefAlreadyUsed`).
    /// The reconcile job uses this to tell "genuinely never paid" apart from "paid, but
    /// our DB missed the confirmation" without sending a doomed transaction.
    /// Returns Ok(false) if the pool isn't configured (nothing could have paid).
    pub async fn reward_ref_used(&self, reference: [u8; 32]) -> Result<bool, String> {
        let pool = match &self.reward_pool {
            Some(p) => p,
            None => return Ok(false),
        };
        pool.reward_ref_used(reference)
            .call()
            .await
            .map_err(|e| format!("rewardRefUsed read failed: {}", e))
    }

    /// Distributes the daily claim G$ reward from the ValorRewardPool to the player's wallet.
    /// Returns Ok(true) on success, Ok(false) if pool not configured, Err on failure.
    pub async fn distribute_daily_claim(&self, player: Address) -> Result<bool, String> {
        let pool = match &self.reward_pool {
            Some(p) => p,
            None => return Ok(false),
        };
        let _tx = self.tx_lock.lock().await;
        pool.distribute_daily_claim(player)
            .send()
            .await
            .map_err(|e| format!("distributeDailyClaim failed: {}", e))?
            .await
            .map_err(|e| format!("distributeDailyClaim tx failed: {}", e))?;
        tracing::info!("distributeDailyClaim: {}", player);
        Ok(true)
    }

    /// Relays a marketplace purchase on behalf of the player.
    /// The player signed an EIP-2612 permit off-chain — no CELO required from them.
    /// This wallet pays gas. Waits for on-chain confirmation before returning.
    pub async fn purchase_item_for(
        &self,
        buyer: Address,
        item_id: u64,
        deadline: u64,
        v: u8,
        r_hex: &str,
        s_hex: &str,
    ) -> Result<H256, String> {
        let marketplace = self
            .marketplace
            .as_ref()
            .ok_or_else(|| "Marketplace relay not configured (MARKETPLACE_CONTRACT unset)".to_string())?;

        let r: [u8; 32] = H256::from_str(r_hex)
            .map_err(|_| format!("Invalid r: {}", r_hex))?
            .0;
        let s: [u8; 32] = H256::from_str(s_hex)
            .map_err(|_| format!("Invalid s: {}", s_hex))?
            .0;

        let call = marketplace.purchase_with_permit(
            buyer,
            U256::from(item_id),
            U256::from(deadline),
            v,
            r,
            s,
        );
        // Hold the tx lock only across broadcast (nonce assignment), then release
        // so the ~90s confirmation wait doesn't serialize other writes behind it.
        let pending = {
            let _tx = self.tx_lock.lock().await;
            call.send().await
                .map_err(|e| format!("TX submission failed: {}", e))?
        };

        let hash = pending.tx_hash();
        tracing::info!("purchaseWithPermit submitted: {:?}", hash);

        // Wait for 1 confirmation (Celo ~5s blocks) — 90s timeout
        tokio::time::timeout(
            Duration::from_secs(90),
            pending.confirmations(1),
        )
        .await
        .map_err(|_| "Transaction timed out waiting for confirmation".to_string())?
        .map_err(|e| format!("Transaction failed on-chain: {}", e))?
        .ok_or_else(|| "Transaction was dropped from mempool".to_string())?;

        tracing::info!("purchaseWithPermit confirmed: {:?}", hash);
        Ok(hash)
    }

    /// Relays a player-initiated G$ transfer to any destination address.
    /// The player signed an EIP-2612 permit granting this wallet an allowance
    /// for the exact amount — no CELO required from them, and Valor never
    /// custodies the funds (this wallet only ever holds the allowance long
    /// enough to move it straight through to `to`). This wallet pays gas for
    /// both steps. Returns the transferFrom tx hash (the one that actually
    /// moves the funds).
    pub async fn transfer_g_for(
        &self,
        from: Address,
        to: Address,
        amount: U256,
        deadline: u64,
        v: u8,
        r_hex: &str,
        s_hex: &str,
    ) -> Result<H256, String> {
        let r: [u8; 32] = H256::from_str(r_hex).map_err(|_| format!("Invalid r: {}", r_hex))?.0;
        let s: [u8; 32] = H256::from_str(s_hex).map_err(|_| format!("Invalid s: {}", s_hex))?.0;
        let spender = self.client.address();

        // 1. Consume the permit — grants this wallet an allowance for `amount`.
        let permit_call = self.g_token.permit(from, spender, amount, U256::from(deadline), v, r, s);
        let permit_pending = {
            let _tx = self.tx_lock.lock().await;
            permit_call.send().await
                .map_err(|e| format!("permit submission failed: {}", e))?
        };
        tokio::time::timeout(Duration::from_secs(90), permit_pending.confirmations(1))
            .await
            .map_err(|_| "permit tx timed out".to_string())?
            .map_err(|e| format!("permit tx failed: {}", e))?
            .ok_or_else(|| "permit tx was dropped from mempool".to_string())?;

        // 2. Move the funds straight to the destination.
        let transfer_call = self.g_token.transfer_from(from, to, amount);
        let transfer_pending = {
            let _tx = self.tx_lock.lock().await;
            transfer_call.send().await
                .map_err(|e| format!("transferFrom submission failed: {}", e))?
        };
        let hash = transfer_pending.tx_hash();
        tokio::time::timeout(Duration::from_secs(90), transfer_pending.confirmations(1))
            .await
            .map_err(|_| "transfer tx timed out".to_string())?
            .map_err(|e| format!("transfer tx failed: {}", e))?
            .ok_or_else(|| "transfer tx was dropped from mempool".to_string())?;

        tracing::info!("transferG: {} -> {} amount={} tx={:?}", from, to, amount, hash);
        Ok(hash)
    }

    /// This wallet's own address — the frontend needs it as the `spender` in
    /// the EIP-2612 permit it signs for `transfer_g_for` above.
    pub fn relay_address(&self) -> Address {
        self.client.address()
    }
}

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

type ChainClient = SignerMiddleware<Provider<Http>, LocalWallet>;

#[derive(Clone)]
pub struct ChainWriter {
    contract:    Arc<ValorGameRecord<ChainClient>>,
    client:      Arc<ChainClient>,
    rank_pools:  HashMap<String, Address>,
    marketplace: Option<Arc<ValorMarketplace<ChainClient>>>,
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

        tracing::info!("ChainWriter ready — game_record={}", contract_addr);
        Some(Self { contract, client, rank_pools, marketplace })
    }

    pub async fn claim_character(
        &self,
        player: Address,
        class: String,
        name: String,
    ) -> Option<H256> {
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
        let pending = call.send().await
            .map_err(|e| format!("TX submission failed: {}", e))?;

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
}

//! The Avalanche C-Chain relay.
//!
//! Deliberately NOT a second `ChainWriter`. That type is Celo-shaped all the way
//! down: it holds a non-optional G$ token, the GoodCollective rank pools, the
//! reward pool and the Endless pool. None of those exist on Avalanche, and
//! bending it to pretend they might would leave every call site checking which
//! chain it was really talking to. Two small honest types beat one type with a
//! chain-shaped hole in it.
//!
//! WHAT THIS WRITES
//!   • Match records — the same real fight already recorded on Celo, written to a
//!     second ledger. This is the transaction volume an Avalanche grant counts.
//!   • Scrip mints — when a player claims their accrued balance in the Bank.
//!
//! WHAT IT DOES NOT WRITE
//!   Anything involving G$. Every G$ payout stays on Celo, permanently, because
//!   Valor's GoodDollar grant requires rewards to be paid in G$ and G$ exists only
//!   on Celo and Fuse. See services::chain_id for the same rule stated once more.
//!
//! GAS IS AVAX, AND IT IS NOT FREE
//!   This was the cost of choosing C-Chain over a Valor L1: on an L1 we would mint
//!   the gas token and writes would be effectively free. Here every write spends
//!   real AVAX from the relay wallet. The relay running dry is already the single
//!   most common cause of failed payouts in this project's history, on a different
//!   chain, with a different token. It will happen here too if nobody watches the
//!   balance, so `relay_can_pay` exists for the same reason it does on Celo.

use ethers::{
    middleware::SignerMiddleware,
    prelude::abigen,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{Address, H256, U256},
};
use std::{str::FromStr, sync::Arc, time::Duration};

use crate::services::chain::{is_out_of_gas, RELAY_OUT_OF_GAS};
use crate::services::chain_id::AVALANCHE;

abigen!(
    ScripToken,
    r#"[
        function mint(address to, uint256 amount) external
        function balanceOf(address account) external view returns (uint256)
        function totalSupply() external view returns (uint256)
    ]"#
);

abigen!(
    AvaxGameRecord,
    r#"[
        function recordBattle(bytes32 battleId, address winner, address loser, uint8 xpWinner, uint8 xpLoser, bool isBot) external
    ]"#
);

abigen!(
    AvaxMarketplace,
    r#"[
        function purchaseWithPermit(address buyer, uint256 itemId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external
    ]"#
);

abigen!(
    AvaxDuel,
    r#"[
        function openWithPermit(bytes32 duelId, address challenger, uint256 stake, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external
        function acceptWithPermit(bytes32 duelId, address opponent, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external
        function resolve(bytes32 duelId, address winner) external
        function resolveDraw(bytes32 duelId) external
        function cancel(bytes32 duelId) external
        function winnerPayout(uint256 stake) external view returns (uint256)
        function escrowedBalance() external view returns (uint256)
    ]"#
);

type ChainClient = SignerMiddleware<Provider<Http>, LocalWallet>;

/// Gas headroom for one write, used to decide whether the relay can afford to try.
///
/// A `recordBattle` costs well under 150k; a `mint` is smaller still. Three times
/// that at the current price is the same 3x cushion the Celo relay uses, because
/// the base fee moves between the check and the send.
const WRITE_GAS_ESTIMATE: u64 = 150_000;

#[derive(Clone)]
pub struct AvalancheWriter {
    client:      Arc<ChainClient>,
    game_record: Arc<AvaxGameRecord<ChainClient>>,
    scrip:       Option<Arc<ScripToken<ChainClient>>>,
    marketplace: Option<Arc<AvaxMarketplace<ChainClient>>>,
    /// The staked-duel escrow. Optional like the others, so a missing address
    /// disables duels rather than the whole relay.
    duel:        Option<Arc<AvaxDuel<ChainClient>>>,
    /// Serialises every state-changing send from this signer.
    ///
    /// Same reason as `ChainWriter::tx_lock`, and it is not optional: a fight
    /// finishing fires a match record while a claim may be minting, and a plain
    /// SignerMiddleware reads the pending nonce independently per transaction. Two
    /// racing writes take the SAME nonce and the loser is rejected as "replacement
    /// transaction underpriced". Holding the lock across each broadcast means the
    /// next send reads the nonce only once the previous one is in the mempool.
    tx_lock:     Arc<tokio::sync::Mutex<()>>,
}

impl AvalancheWriter {
    /// Builds the relay from the environment, or `None` if it is not configured.
    ///
    /// `None` is the normal state until the contracts are deployed, and it must
    /// stay harmless: the app runs perfectly well with no Avalanche relay at all,
    /// it simply writes nothing there. Every call site treats a missing writer as
    /// "skip", never as an error, exactly as the Celo writer is treated today.
    ///
    /// Required:
    ///   AVALANCHE_PRIVATE_KEY          — the relay wallet's key. Use a DIFFERENT
    ///                                    key from the Celo relay: sharing one means
    ///                                    a single compromise takes both chains, and
    ///                                    an Avalanche bug could drain the wallet
    ///                                    that pays real G$.
    ///   AVALANCHE_GAME_RECORD_CONTRACT — ValorGameRecord proxy on C-Chain.
    /// Optional:
    ///   SCRIP_CONTRACT                 — the Scrip token. Without it, claims cannot
    ///                                    settle but match records still write.
    ///   AVALANCHE_RPC_URL              — defaults to a public endpoint.
    pub fn from_env() -> Option<Self> {
        let private_key = std::env::var("AVALANCHE_PRIVATE_KEY").ok()?;
        let record_addr = std::env::var("AVALANCHE_GAME_RECORD_CONTRACT").ok()?;
        let rpc_url = std::env::var("AVALANCHE_RPC_URL")
            .unwrap_or_else(|_| "https://avalanche.api.onfinality.io/public/ext/bc/C/rpc".to_string());

        let wallet: LocalWallet = private_key
            .trim_start_matches("0x")
            .parse::<LocalWallet>()
            .map_err(|e| tracing::warn!("AvalancheWriter: invalid key: {}", e))
            .ok()?
            // Signing with the wrong chain id produces a transaction the node
            // rejects, or worse, one that is valid somewhere it was never meant
            // for. This is the whole purpose of EIP-155.
            .with_chain_id(AVALANCHE as u64);

        let provider = Provider::<Http>::try_from(rpc_url.as_str())
            .map_err(|e| tracing::warn!("AvalancheWriter: bad RPC URL: {}", e))
            .ok()?
            .interval(Duration::from_millis(500));

        let record: Address = record_addr
            .parse()
            .map_err(|e| tracing::warn!("AvalancheWriter: bad game record addr: {}", e))
            .ok()?;

        let client = Arc::new(SignerMiddleware::new(provider, wallet));

        // Optional and parsed separately so a typo'd Scrip address disables minting
        // rather than taking down match recording with it.
        let scrip = std::env::var("SCRIP_CONTRACT").ok().and_then(|a| {
            Address::from_str(&a)
                .map_err(|e| tracing::warn!("AvalancheWriter: bad SCRIP_CONTRACT: {}", e))
                .ok()
                .map(|addr| Arc::new(ScripToken::new(addr, client.clone())))
        });

        // Same treatment as Scrip: parsed separately so a bad address disables ONE
        // capability rather than taking match recording down with it.
        let marketplace = std::env::var("AVALANCHE_MARKETPLACE_CONTRACT").ok().and_then(|a| {
            Address::from_str(&a)
                .map_err(|e| tracing::warn!("AvalancheWriter: bad AVALANCHE_MARKETPLACE_CONTRACT: {}", e))
                .ok()
                .map(|addr| Arc::new(AvaxMarketplace::new(addr, client.clone())))
        });

        // Same treatment again. Duels are the mode this chain exists for, so a bad
        // address here is worth a loud line in the log rather than a silent absence.
        let duel = std::env::var("AVALANCHE_DUEL_CONTRACT").ok().and_then(|a| {
            Address::from_str(&a)
                .map_err(|e| tracing::warn!("AvalancheWriter: bad AVALANCHE_DUEL_CONTRACT: {}", e))
                .ok()
                .map(|addr| Arc::new(AvaxDuel::new(addr, client.clone())))
        });

        tracing::info!(
            "Avalanche relay ready: {:?} (scrip: {}, marketplace: {}, duels: {})",
            client.address(),
            if scrip.is_some() { "yes" } else { "NOT SET — claims cannot settle" },
            if marketplace.is_some() { "yes" } else { "NOT SET — SCRP purchases disabled" },
            if duel.is_some() { "yes" } else { "NOT SET — staked duels disabled" },
        );

        Some(Self {
            game_record: Arc::new(AvaxGameRecord::new(record, client.clone())),
            client,
            scrip,
            marketplace,
            duel,
            tx_lock: Arc::new(tokio::sync::Mutex::new(())),
        })
    }

    /// The relay's AVAX balance.
    pub async fn relay_gas_balance(&self) -> Option<U256> {
        self.client.get_balance(self.client.address(), None).await.ok()
    }

    /// Whether the relay can afford one write right now.
    ///
    /// Returns true when the balance cannot be read, matching the Celo writer: an
    /// RPC blip must not silently stop the game recording matches.
    pub async fn relay_can_pay(&self) -> bool {
        let Some(balance) = self.relay_gas_balance().await else { return true };
        let price = self
            .client
            .get_gas_price()
            .await
            .unwrap_or_else(|_| U256::from(50_000_000_000u64));
        balance >= price * U256::from(WRITE_GAS_ESTIMATE) * U256::from(3u64)
    }

    /// Confirms a broadcast transaction actually succeeded, polling past a missing
    /// receipt.
    ///
    /// WHY THIS EXISTS. ethers' pending-transaction future resolves to `Ok(None)`
    /// when the RPC does not hand back a receipt, and the obvious reading of that
    /// is "the transaction was dropped". It usually is not: public endpoints
    /// intermittently fail to return a receipt for a transaction that mined
    /// perfectly well. Trusting that reading cost us 3 of 14 mirrored matches —
    /// they landed on-chain, we concluded they had not, and never recorded them.
    ///
    /// The fix is NOT to assume the opposite and record the hash on broadcast.
    /// That trades an undercount for an overcount: a reverted transaction would be
    /// filed as a real match, and match counts are exactly the figure a grant
    /// reviewer checks against the chain. So this asks the chain directly, a few
    /// times, and only reports success when a receipt says `status == 1`.
    async fn confirm(&self, hash: H256) -> bool {
        for attempt in 0..5 {
            // C-Chain finalises in ~2s. Waiting first, then asking, avoids
            // querying for a receipt that cannot exist yet.
            tokio::time::sleep(Duration::from_secs(2)).await;
            match self.client.get_transaction_receipt(hash).await {
                Ok(Some(r)) => {
                    let ok = r.status.map(|s| s.as_u64() == 1).unwrap_or(false);
                    if !ok {
                        tracing::warn!("Avalanche tx {:?} mined but REVERTED", hash);
                    }
                    return ok;
                }
                Ok(None) => continue, // not mined yet, or the RPC is lagging
                Err(e) => {
                    tracing::debug!("receipt lookup {} for {:?} failed: {}", attempt, hash, e);
                    continue;
                }
            }
        }
        tracing::warn!("Avalanche tx {:?} still unconfirmed after polling; not recording", hash);
        false
    }

    /// Mirrors a match onto Avalanche. `None` on any failure.
    ///
    /// Failing here must never fail the fight: the match already happened, the
    /// player already has their XP, and Celo already holds the authoritative
    /// record. A missing mirror costs a row in a reporting table, nothing more.
    pub async fn record_battle(
        &self,
        battle_id: [u8; 32],
        winner: Address,
        loser: Address,
        xp_winner: u8,
        xp_loser: u8,
        is_bot: bool,
    ) -> Option<H256> {
        let _guard = self.tx_lock.lock().await;

        let call = self
            .game_record
            .record_battle(battle_id, winner, loser, xp_winner, xp_loser, is_bot);

        match call.send().await {
            Ok(pending) => {
                // Captured at broadcast so it survives a receipt the RPC never
                // returns. The hash is known the moment the transaction is signed.
                let hash = pending.tx_hash();
                match pending.await {
                    Ok(Some(receipt)) => Some(receipt.transaction_hash),
                    // No receipt is NOT proof it was dropped — see `confirm`. Ask the
                    // chain rather than guessing either way.
                    Ok(None) | Err(_) => {
                        if self.confirm(hash).await {
                            tracing::info!("Avalanche recordBattle confirmed on retry: {:?}", hash);
                            Some(hash)
                        } else {
                            None
                        }
                    }
                }
            }
            Err(e) => {
                let msg = e.to_string();
                if is_out_of_gas(&msg) {
                    // Named explicitly so this never gets misread as a game bug the
                    // way the Celo equivalent was for hours.
                    tracing::error!("{}: Avalanche relay is out of AVAX: {}", RELAY_OUT_OF_GAS, msg);
                } else {
                    tracing::warn!("Avalanche recordBattle failed: {}", msg);
                }
                None
            }
        }
    }

    /// Mints Scrip to a player, settling a claim.
    ///
    /// Returns the transaction hash, or an error string the caller MUST act on by
    /// failing the claim and releasing its earnings. Unlike a missed match record,
    /// a silently dropped mint is money the player was told they had and never
    /// received. See `services::earnings::fail_claim`.
    pub async fn mint_scrip(&self, to: Address, amount: U256) -> Result<H256, String> {
        let scrip = self
            .scrip
            .as_ref()
            .ok_or_else(|| "SCRIP_CONTRACT is not set; claims cannot settle".to_string())?;

        let _guard = self.tx_lock.lock().await;

        // Bound to a local first: `scrip.mint(..)` returns a builder that the
        // pending-transaction future borrows from, so inlining it drops the builder
        // while the receipt is still being awaited.
        let call = scrip.mint(to, amount);
        let pending = call.send().await.map_err(|e| {
            let msg = e.to_string();
            if is_out_of_gas(&msg) {
                format!("{}: Avalanche relay is out of AVAX: {}", RELAY_OUT_OF_GAS, msg)
            } else {
                msg
            }
        })?;

        let hash = pending.tx_hash();
        match pending.await {
            Ok(Some(receipt)) => Ok(receipt.transaction_hash),
            // A missing receipt is NOT proof the mint failed, and here that
            // distinction costs real balance: the caller responds to an error by
            // releasing the earnings, so a mint that actually succeeded would let
            // the player claim the same Scrip a second time and mint it twice.
            // Ask the chain before concluding anything.
            Ok(None) | Err(_) => {
                if self.confirm(hash).await {
                    tracing::info!("SCRP mint confirmed on retry: {:?}", hash);
                    Ok(hash)
                } else {
                    Err(format!("mint {hash:?} could not be confirmed"))
                }
            }
        }
    }

    /// Relays a SCRP marketplace purchase, so the player needs no AVAX for gas.
    ///
    /// Mirrors `ChainWriter::purchase_item_for`. The permit the buyer signed must be
    /// for the price THIS chain's marketplace holds — 6,000 SCRP where Celo says
    /// 1,200 G$ — or `permit()` rejects the signature and the whole thing reverts
    /// after they have already approved it. That is why the items API serves
    /// per-chain prices rather than one number.
    pub async fn purchase_item_for(
        &self,
        buyer: Address,
        item_id: u64,
        deadline: u64,
        v: u8,
        r_hex: &str,
        s_hex: &str,
    ) -> Result<H256, String> {
        let marketplace = self.marketplace.as_ref().ok_or_else(|| {
            "SCRP purchases are not configured (AVALANCHE_MARKETPLACE_CONTRACT unset)".to_string()
        })?;

        let r: [u8; 32] = H256::from_str(r_hex).map_err(|_| format!("Invalid r: {r_hex}"))?.0;
        let s: [u8; 32] = H256::from_str(s_hex).map_err(|_| format!("Invalid s: {s_hex}"))?.0;

        let call = marketplace.purchase_with_permit(
            buyer,
            U256::from(item_id),
            U256::from(deadline),
            v,
            r,
            s,
        );

        // Hold the nonce lock only across broadcast, then release so the confirmation
        // wait does not serialize match mirroring behind a purchase.
        let pending = {
            let _guard = self.tx_lock.lock().await;
            call.send().await.map_err(|e| {
                let msg = e.to_string();
                if is_out_of_gas(&msg) {
                    format!("{RELAY_OUT_OF_GAS}: Avalanche relay is out of AVAX: {msg}")
                } else {
                    format!("TX submission failed: {msg}")
                }
            })?
        };

        let hash = pending.tx_hash();
        tracing::info!("SCRP purchaseWithPermit submitted: {:?}", hash);

        // C-Chain finalises in ~2s, so 60s is generous rather than tight.
        tokio::time::timeout(Duration::from_secs(60), pending.confirmations(1))
            .await
            .map_err(|_| "Transaction timed out waiting for confirmation".to_string())?
            .map_err(|e| format!("Transaction failed on-chain: {e}"))?
            .ok_or_else(|| "Transaction was dropped from mempool".to_string())?;

        tracing::info!("SCRP purchaseWithPermit confirmed: {:?}", hash);
        Ok(hash)
    }

    /// Whether SCRP purchases can be relayed at all.
    pub fn can_sell(&self) -> bool {
        self.marketplace.is_some()
    }

    /// The relay's own address, for logging and balance alerts.
    pub fn relay_address(&self) -> Address {
        self.client.address()
    }

    /// Whether Scrip minting is available.
    pub fn can_mint(&self) -> bool {
        self.scrip.is_some()
    }

    // ── Staked duels ──────────────────────────────────────────────────────────
    //
    // The escrow contract holds both stakes for the duration of a duel, which is
    // the difference between this and the Celo rail: there, stakes move into the
    // ValorRewardPool and the backend pays the winner out of it, so player money
    // sits somewhere the operator controls. Here the relay can only ever tell the
    // contract WHICH of the two participants won. It cannot direct the pot
    // anywhere else, and it cannot touch a stake at all if it simply stops
    // calling. See contracts/src/ValorDuel.sol for the reasoning in full.

    /// Whether staked duels can be settled at all.
    pub fn can_duel(&self) -> bool {
        self.duel.is_some()
    }

    fn duel_contract(&self) -> Result<&Arc<AvaxDuel<ChainClient>>, String> {
        self.duel
            .as_ref()
            .ok_or_else(|| "Staked duels are not configured (AVALANCHE_DUEL_CONTRACT unset)".to_string())
    }

    /// Escrow the challenger's stake and open a duel on-chain.
    ///
    /// `stake` is in SCRP wei and must match the amount the player's permit
    /// authorised, because the contract passes it straight into `permit()`. A
    /// mismatch fails the signature check rather than moving the wrong sum.
    pub async fn duel_open(
        &self,
        duel_id: [u8; 32],
        challenger: Address,
        stake: U256,
        deadline: u64,
        v: u8,
        r_hex: &str,
        s_hex: &str,
    ) -> Result<H256, String> {
        let (r, s) = parse_sig(r_hex, s_hex)?;
        let call = self.duel_contract()?.open_with_permit(
            duel_id,
            challenger,
            stake,
            U256::from(deadline),
            v,
            r,
            s,
        );
        self.send_and_confirm(call, "duel open").await
    }

    /// Escrow the opponent's stake against an already-open duel.
    ///
    /// The amount is deliberately absent: the contract reads it from the duel it
    /// already stored, so an opponent can never be signed up for a different
    /// number than the challenger put down.
    pub async fn duel_accept(
        &self,
        duel_id: [u8; 32],
        opponent: Address,
        deadline: u64,
        v: u8,
        r_hex: &str,
        s_hex: &str,
    ) -> Result<H256, String> {
        let (r, s) = parse_sig(r_hex, s_hex)?;
        let call = self
            .duel_contract()?
            .accept_with_permit(duel_id, opponent, U256::from(deadline), v, r, s);
        self.send_and_confirm(call, "duel accept").await
    }

    /// Pay the pot, minus the house cut, to the winner.
    pub async fn duel_resolve(&self, duel_id: [u8; 32], winner: Address) -> Result<H256, String> {
        let call = self.duel_contract()?.resolve(duel_id, winner);
        self.send_and_confirm(call, "duel resolve").await
    }

    /// Return both stakes on a tie. No cut is taken on a duel nobody won.
    pub async fn duel_draw(&self, duel_id: [u8; 32]) -> Result<H256, String> {
        let call = self.duel_contract()?.resolve_draw(duel_id);
        self.send_and_confirm(call, "duel draw").await
    }

    /// Refund an unaccepted duel's stake to the challenger.
    pub async fn duel_cancel(&self, duel_id: [u8; 32]) -> Result<H256, String> {
        let call = self.duel_contract()?.cancel(duel_id);
        self.send_and_confirm(call, "duel cancel").await
    }

    /// What the contract would pay a winner at this stake.
    ///
    /// Read from the chain rather than recomputed here so the figure a player is
    /// shown before staking is the figure the contract will actually transfer. A
    /// house cut changed on-chain and not mirrored in the backend would otherwise
    /// quote players a number nothing pays.
    pub async fn duel_winner_payout(&self, stake: U256) -> Result<U256, String> {
        self.duel_contract()?
            .winner_payout(stake)
            .call()
            .await
            .map_err(|e| e.to_string())
    }

    /// Broadcast a duel transaction and make sure it actually landed.
    ///
    /// Duel calls move player money, so the ambiguity `confirm` exists to resolve
    /// matters more here than anywhere else: reporting a failed stake that
    /// actually succeeded would charge a player and give them nothing, and
    /// reporting a failed resolve that succeeded would pay a winner twice on retry.
    async fn send_and_confirm(
        &self,
        call: ethers::contract::ContractCall<ChainClient, ()>,
        what: &str,
    ) -> Result<H256, String> {
        // Hold the nonce lock across broadcast only, then release: waiting on a
        // confirmation must not serialise every other write behind it.
        let pending = {
            let _guard = self.tx_lock.lock().await;
            call.send().await.map_err(|e| {
                let msg = e.to_string();
                if is_out_of_gas(&msg) {
                    format!("{RELAY_OUT_OF_GAS}: Avalanche relay is out of AVAX: {msg}")
                } else {
                    format!("{what} failed to submit: {msg}")
                }
            })?
        };

        let hash = pending.tx_hash();
        match tokio::time::timeout(Duration::from_secs(60), pending.confirmations(1)).await {
            Ok(Ok(Some(_))) => {
                tracing::info!("Avalanche {} confirmed: {:?}", what, hash);
                Ok(hash)
            }
            // Timed out, dropped, or no receipt returned. None of those is proof of
            // failure on a public endpoint, so ask the chain directly.
            _ => {
                if self.confirm(hash).await {
                    tracing::info!("Avalanche {} confirmed on retry: {:?}", what, hash);
                    Ok(hash)
                } else {
                    Err(format!("{what} {hash:?} could not be confirmed"))
                }
            }
        }
    }
}

/// Split hex `r` and `s` out of a client-supplied permit signature.
fn parse_sig(r_hex: &str, s_hex: &str) -> Result<([u8; 32], [u8; 32]), String> {
    let r: [u8; 32] = H256::from_str(r_hex).map_err(|_| format!("Invalid r: {r_hex}"))?.0;
    let s: [u8; 32] = H256::from_str(s_hex).map_err(|_| format!("Invalid s: {s_hex}"))?.0;
    Ok((r, s))
}

/// A duel's on-chain id, derived from its database row id.
///
/// The UUID's 16 bytes are left-aligned into a bytes32 and the rest left zero. A
/// hash would work equally well for uniqueness, but padding is reversible: given a
/// `DuelOpened` event on Snowtrace, the first 16 bytes ARE the primary key of the
/// row, so anyone can line the chain up against the database without a lookup
/// table. That property is worth more than the aesthetics of a hash.
pub fn duel_id_bytes(id: uuid::Uuid) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[..16].copy_from_slice(id.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_duel_id_round_trips_back_to_its_row() {
        let id = uuid::Uuid::new_v4();
        let bytes = duel_id_bytes(id);
        assert_eq!(&bytes[..16], id.as_bytes(), "the row id must be readable off the chain");
        assert_eq!(&bytes[16..], &[0u8; 16], "the tail is padding, not data");
    }

    #[test]
    fn distinct_duels_get_distinct_ids() {
        let a = duel_id_bytes(uuid::Uuid::new_v4());
        let b = duel_id_bytes(uuid::Uuid::new_v4());
        assert_ne!(a, b);
    }
}

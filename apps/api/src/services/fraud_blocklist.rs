//! Wallets permanently banned from every Valor reward pool payout.
//!
//! Checked at the one place all payouts funnel through — every `distribute_*` call
//! in `services::chain` — so listing a wallet here blocks it from ALL reward types
//! (referral, battle, rank-up, season, endless, UBI, challenge grant) in one place,
//! not just whichever path an incident happened to be found through. Add a wallet
//! here to remove it from Valor totally; nothing else needs touching.
//!
//! Compared by parsed `Address`, not string equality, so casing never matters.

use ethers::types::Address;

pub const BLOCKED_WALLETS: &[&str] = &[
    "0x03fa336e3772c80a90238edee4f34502e9efaadf", // 2026-08-16 referral-farming bot
    "0x4fe207375e0c7bff67d94322e65cfac251366d61", // 2026-08-16 referral-farming bot
    "0x8a408c186a29abade67cbedc14e67c5ddac6c380", // 2026-08-16 referral-farming bot
];

pub fn is_blocked(wallet: Address) -> bool {
    BLOCKED_WALLETS
        .iter()
        .any(|w| w.parse::<Address>().map(|a| a == wallet).unwrap_or(false))
}

pub fn is_blocked_str(wallet: &str) -> bool {
    wallet.parse::<Address>().map(is_blocked).unwrap_or(false)
}

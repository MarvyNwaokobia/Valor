//! Which chain a transaction landed on.
//!
//! Not to be confused with `services::chain`, which is the ethers client that
//! WRITES transactions. This module only names chains and their ids.
//!
//! WHY THIS IS AN ENUM AND NOT A BARE INTEGER
//! ------------------------------------------
//! `g_ledger.chain_id` defaults to Celo in SQL, which is correct for every row
//! written so far. But a default is a trap for new code: a payout on a second
//! chain whose call site forgot to pass one would silently record as Celo, and
//! nothing would ever surface it. Reporting would be quietly wrong and the money
//! would still have moved.
//!
//! So `insert_ledger_entry` takes a `ChainId` as a REQUIRED argument. The
//! compiler, not a code reviewer, is what stops that mistake. This codebase has
//! already been bitten once by a silent write failure (the 999 XP cap, swallowed
//! by `let _ =`), which is the argument for paying the small ergonomic cost here.

/// Celo mainnet. Every Valor transaction is here.
pub const CELO: i32 = 42220;

/// Chains Valor can record a transaction on.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ChainId {
    /// G$ payouts, GoodDollar identity, MiniPay. The money rail.
    Celo,
}

impl ChainId {
    /// The numeric id to store.
    pub fn as_i32(self) -> i32 {
        match self {
            ChainId::Celo => CELO,
        }
    }

    /// What players earn and spend here. Used for ledger display and for the
    /// Bank's payout options.
    #[allow(dead_code)]
    pub fn currency_symbol(self) -> &'static str {
        match self {
            ChainId::Celo => "G$",
        }
    }

    /// Does this chain pay real, withdrawable money?
    ///
    /// Celo does: G$ is a live currency with an exchange rate, and the
    /// GoodDollar whitelist is what stops one person farming it from fifty
    /// wallets. Any chain added here without a proof-of-unique-human of its own
    /// must answer `false` — flipping that without a sybil answer is the single
    /// most expensive mistake available in this codebase.
    #[allow(dead_code)]
    pub fn is_redeemable(self) -> bool {
        match self {
            ChainId::Celo => true,
        }
    }

    /// Recognise a stored id. Unknown ids read as `None` rather than falling
    /// back to Celo, because mislabelling another chain's row as Celo is exactly
    /// the corruption this module exists to prevent.
    #[allow(dead_code)]
    pub fn from_i32(id: i32) -> Option<Self> {
        match id {
            CELO => Some(ChainId::Celo),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip() {
        for c in [ChainId::Celo] {
            assert_eq!(ChainId::from_i32(c.as_i32()), Some(c), "{c:?}");
        }
        assert_eq!(ChainId::Celo.as_i32(), 42220);
    }

    #[test]
    fn an_unknown_id_is_none_not_celo() {
        // The dangerous direction: a row written by a future chain must not read
        // back as Celo and quietly join Celo's reported volume.
        assert_eq!(ChainId::from_i32(1), None);
        assert_eq!(ChainId::from_i32(0), None);
        assert_eq!(ChainId::from_i32(44787), None, "Alfajores testnet is not mainnet");
    }

    #[test]
    fn celo_pays_real_money() {
        assert!(ChainId::Celo.is_redeemable());
        assert_eq!(ChainId::Celo.currency_symbol(), "G$");
    }
}

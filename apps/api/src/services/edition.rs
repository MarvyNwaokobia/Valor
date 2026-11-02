//! Whether a wallet may be paid real money.
//!
//! Valor has one edition, `web`: it pays real G$, gated on the GoodDollar whitelist
//! in onboarding. Every new player is stored as `web`, and the signup handler no
//! longer reads an edition from the request at all.
//!
//! The `players.edition` column is kept for the rows that predate that. A player
//! whose stored value is anything other than `web` was created in a non-earning
//! mode and stays non-earning: they keep their progress, but no payout path will
//! bank them G$. Those values are not created any more and cannot be set from the
//! API; the database CHECK constraint is what bounds them.
//!
//! Every payout path asks the one question below, so a new earn surface cannot
//! forget to.

use sqlx::PgPool;

/// The only edition that earns, and the value every new player is stored with.
pub const WEB: &str = "web";

/// Does a player stored under `edition` earn real, withdrawable money?
///
/// This is deliberately about MONEY only: XP, ranks, unlocks, scores and
/// leaderboards are untouched, exactly as under the earning pause.
pub fn earns_real_money(edition: &str) -> bool {
    edition.trim().eq_ignore_ascii_case(WEB)
}

/// Whether this wallet may be paid real money at all.
///
/// An unknown wallet earns. That matters for the reward paths, which can be reached
/// by a wallet whose player row is still being written, and for the players who
/// predate the column. Refusing to pay on a missed lookup would turn a transient
/// read into a silent pay cut, which is the failure mode `cap_reward`'s pool-balance
/// read is also written to avoid.
pub async fn wallet_earns(db: &PgPool, wallet: &str) -> bool {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT edition FROM players WHERE wallet_address = $1")
            .bind(wallet)
            .fetch_optional(db)
            .await
            .unwrap_or(None);
    row.map(|(e,)| earns_real_money(&e)).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_web_edition_earns() {
        for v in ["web", "WEB", " Web "] {
            assert!(earns_real_money(v), "{v:?}");
        }
        assert_eq!(WEB, "web");
    }

    #[test]
    fn any_other_stored_value_does_not_earn() {
        // Rows created before this was simplified carry a non-web value. They must
        // stay non-earning, so nothing but `web` may pay.
        for v in ["", "banana", "webx", "legacy"] {
            assert!(!earns_real_money(v), "{v:?}");
        }
    }
}

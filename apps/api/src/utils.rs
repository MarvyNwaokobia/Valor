/// Returns true if `addr` is a valid Ethereum address (0x + 40 hex chars).
pub fn is_valid_wallet(addr: &str) -> bool {
    addr.len() == 42
        && addr.starts_with("0x")
        && addr[2..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Normalises a wallet address to lowercase for DB comparisons.
pub fn normalize_wallet(addr: &str) -> String {
    addr.to_lowercase()
}

/// The name to show for a wallet in a notification — username first, character
/// name as the fallback, same COALESCE order used everywhere else a player is
/// named (duel lobbies, achievements). None if the wallet has no player row.
pub async fn display_name(db: &sqlx::PgPool, wallet: &str) -> Option<String> {
    sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(username, ''), character_name) FROM players WHERE wallet_address = $1",
    )
    .bind(wallet)
    .fetch_optional(db)
    .await
    .unwrap_or(None)
}

//! Startup migrations — apply pending schema changes automatically on boot.
//!
//! Before this, migrations in `migrations/*.sql` were applied BY HAND via psql. That is
//! exactly how a schema-dependent deploy breaks silently: the code ships (Railway
//! auto-deploys from main) while the migration sits unrun, so the feature that needs the
//! new column errors on every request. The `add_repeating_decay` column nearly hit this.
//!
//! Design, chosen to fit THIS repo rather than a generic tool:
//!   • The .sql files are hand-written and already IDEMPOTENT (every CREATE/ALTER/INDEX is
//!     guarded with IF NOT EXISTS, every constraint drops-then-adds, every seed has ON
//!     CONFLICT). They are NOT sqlx-convention-named and are deliberately re-runnable, so
//!     sqlx's checksum-locked migrator (which forbids editing an applied file) is the
//!     wrong fit. We track applied files in `_schema_migrations` and run each once, in a
//!     fixed order, inside a transaction.
//!   • Files are EMBEDDED in the binary with include_str!, so a deployed container needs
//!     no migrations/ directory on disk.
//!   • `init.sql` runs first (it creates the base tables); everything else is an additive
//!     ALTER on those tables and is ordered alphabetically after it. Adding a migration =
//!     drop the file in migrations/ and add one line to MIGRATIONS below.
//!
//! Baseline: a DB that already had every migration applied by hand (i.e. prod at the time
//! this shipped) gets `_schema_migrations` created empty on first boot, so the migrator
//! re-runs all files once. That is safe precisely because they are idempotent — each is a
//! no-op against the existing schema — and thereafter they are recorded and skipped.

use sqlx::PgPool;

/// (filename, embedded SQL). ORDER MATTERS: `init.sql` first (base tables), then the rest
/// alphabetically — each of those only adds to init's tables, so alphabetical is safe.
/// Add new migrations at the end (or anywhere after init if order-independent).
const MIGRATIONS: &[(&str, &str)] = &[
    ("init.sql",                  include_str!("../migrations/init.sql")),
    ("add_chain_tx_columns.sql",  include_str!("../migrations/add_chain_tx_columns.sql")),
    ("add_character_confirmed.sql", include_str!("../migrations/add_character_confirmed.sql")),
    ("add_endless_rewards.sql",   include_str!("../migrations/add_endless_rewards.sql")),
    ("add_first_clear_bounties.sql", include_str!("../migrations/add_first_clear_bounties.sql")),
    ("add_gdollar_ledger.sql",    include_str!("../migrations/add_gdollar_ledger.sql")),
    ("add_magic_identity.sql",    include_str!("../migrations/add_magic_identity.sql")),
    ("add_prestige_and_tiers.sql", include_str!("../migrations/add_prestige_and_tiers.sql")),
    ("add_rank_up_rewards.sql",   include_str!("../migrations/add_rank_up_rewards.sql")),
    ("add_ranked_xp_lifetime.sql", include_str!("../migrations/add_ranked_xp_lifetime.sql")),
    ("add_repeating_decay.sql",   include_str!("../migrations/add_repeating_decay.sql")),
    ("add_season_payouts.sql",    include_str!("../migrations/add_season_payouts.sql")),
    ("add_survival_rearms.sql",   include_str!("../migrations/add_survival_rearms.sql")),
    ("add_survival_runs.sql",     include_str!("../migrations/add_survival_runs.sql")),
    ("fix_decimal_columns.sql",   include_str!("../migrations/fix_decimal_columns.sql")),
    ("fix_xp_cap.sql",            include_str!("../migrations/fix_xp_cap.sql")),
];

/// Apply every migration not yet recorded, in order, each in its own transaction. Called
/// once at startup before the server binds. A failure here aborts boot on purpose — a box
/// serving requests against a half-migrated schema is worse than a box that won't start.
pub async fn run(db: &PgPool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _schema_migrations (
             name       TEXT PRIMARY KEY,
             applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )",
    )
    .execute(db)
    .await?;

    let applied: Vec<String> =
        sqlx::query_scalar("SELECT name FROM _schema_migrations").fetch_all(db).await?;

    let mut ran = 0;
    for (name, sql) in MIGRATIONS {
        if applied.iter().any(|a| a == name) {
            continue;
        }
        tracing::info!("migration: applying {}", name);
        let mut tx = db.begin().await?;
        // raw_sql uses the simple query protocol, so it runs the whole multi-statement
        // file (and handles $$-quoted function bodies) in one round trip.
        sqlx::raw_sql(sql)
            .execute(&mut *tx)
            .await
            .map_err(|e| anyhow::anyhow!("migration {} failed: {}", name, e))?;
        sqlx::query("INSERT INTO _schema_migrations (name) VALUES ($1)")
            .bind(name)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        ran += 1;
    }

    if ran == 0 {
        tracing::info!("migrations: schema up to date ({} known)", MIGRATIONS.len());
    } else {
        tracing::info!("migrations: applied {} new, {} total", ran, MIGRATIONS.len());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::MIGRATIONS;

    #[test]
    fn init_runs_first_and_names_are_unique() {
        // init.sql creates the base tables; every other file ALTERs them, so it must lead.
        assert_eq!(MIGRATIONS[0].0, "init.sql");
        let mut seen = std::collections::HashSet::new();
        for (name, sql) in MIGRATIONS {
            assert!(seen.insert(*name), "duplicate migration name: {}", name);
            assert!(!sql.trim().is_empty(), "{} is embedded empty", name);
        }
    }

    #[test]
    fn every_migration_after_init_is_ordered() {
        // The non-init files run in the order listed; keeping them alphabetical makes the
        // list easy to eyeball against `ls migrations/` and catch a missing entry.
        let rest: Vec<&str> = MIGRATIONS[1..].iter().map(|(n, _)| *n).collect();
        let mut sorted = rest.clone();
        sorted.sort_unstable();
        assert_eq!(rest, sorted, "non-init migrations must stay alphabetically ordered");
    }
}

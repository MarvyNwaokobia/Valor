#!/usr/bin/env bash
# SUPERSEDED (2026-08-16): the public dashboard's query 8112548 no longer reads
# this CSV — it reads on-chain events directly (see its own header comment for
# why: this file's numbers sat ~35% below reality between manual uploads, and
# "active_users" here has no time window). Uploading a fresh CSV to Dune will
# NOT change anything the dashboard shows. Keeping this script correct anyway
# as a Postgres-side sanity check / fallback, not because anything reads it.
#
# Usage:  ./dune/refresh_metrics.sh
#
# played_users  = distinct wallets with at least one recorded game: a `battles`
#                 row in ANY mode (campaign/bot/pvp/endless) or a `survival_runs`
#                 row (Season/Gauntlet). Excludes bare g_ledger touches (e.g. a
#                 UBI claim isn't gameplay).
# active_users  = played_users OR touched G$ in any way (g_ledger row of any
#                 category). Broader than played_users. Mirrors
#                 apps/api/src/handlers/admin.rs's active_players query, incl.
#                 both battles.challenger_wallet AND battles.opponent_wallet
#                 (a wallet that only ever appears as opponent in a real PvP
#                 duel was previously missed here).
#
# played_users  = distinct wallets with at least one recorded game: a `battles`
#                 row in ANY mode (campaign/bot/pvp/endless) or a `survival_runs`
#                 row (Season/Gauntlet). Excludes bare g_ledger touches (e.g. a
#                 UBI claim isn't gameplay).
# active_users  = played_users OR touched G$ in any way (g_ledger row of any
#                 category). Broader than played_users. Mirrors
#                 apps/api/src/handlers/admin.rs's active_players query, incl.
#                 both battles.challenger_wallet AND battles.opponent_wallet
#                 (a wallet that only ever appears as opponent in a real PvP
#                 duel was previously missed here).
set -euo pipefail

cd "$(dirname "$0")/.."
export $(grep -E "^DATABASE_URL" apps/api/.env)

OUT="dune/valor_metrics.csv"
psql "$DATABASE_URL" --csv -o "$OUT" -c "
select
  (select count(*) from players)                                    as registered_users,
  (select count(*) from players where character_confirmed = true)   as onboarded_users,
  (select count(distinct wallet) from (
      select challenger_wallet as wallet from battles
      union select opponent_wallet as wallet from battles
      union select wallet_address from survival_runs) t)            as played_users,
  (select count(distinct wallet) from (
      select challenger_wallet as wallet from battles
      union select opponent_wallet as wallet from battles
      union select wallet_address from survival_runs
      union select wallet_address from g_ledger) t)                 as active_users,
  (select count(*) from battles)                                    as total_battles,
  (select coalesce(sum(amount),0) from g_ledger
     where category in ('ubi_claim','battle_reward','season_reward','challenge_reward')) as gd_awarded,
  (select coalesce(sum(amount),0) from g_ledger)                    as gd_volume_moved,
  now()::date                                                       as snapshot_date;"

echo "Wrote $OUT:"
cat "$OUT"
echo
echo "Next: upload $OUT to Dune Data uploads, dataset name 'valor_metrics' (overwrite)."

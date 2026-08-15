#!/usr/bin/env bash
# Regenerate dune/valor_metrics.csv from the LIVE prod DB, then re-upload it to Dune.
#
# Usage:  ./dune/refresh_metrics.sh
# Then:   Dune -> Library -> Data uploads -> replace the "valor_metrics" dataset
#         with the new file. Same dataset name = every counter on the dashboard
#         updates automatically (no query changes needed).
#
# The dashboard reads these via query 8112548 (dune.marvyy.dataset_valor_metrics):
#   Registered / Onboarded / Active Users counters in the Users section.
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

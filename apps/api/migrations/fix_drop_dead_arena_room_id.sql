-- `duels.arena_room_id` (add_duel_modes.sql) anticipated needing a persisted
-- room id so a Face-Off reconnect could rejoin the same room. It never got
-- read or written anywhere: `arena_server.rs` pairs and keys rooms by
-- `duel_id.to_string()` directly, which is already deterministic and
-- reconnectable from the duel row alone (see the reconnect support added
-- 2026-08-23) — a separate stored id would only ever duplicate that value.
-- Dead column, dropped rather than left to confuse a future reader into
-- thinking reconnect depends on it.
ALTER TABLE duels DROP COLUMN IF EXISTS arena_room_id;

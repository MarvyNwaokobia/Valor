-- Face-Off — real-time head-to-head PvP duels, layered onto the existing
-- async score-duel table rather than a parallel one.
--
-- `mode` distinguishes the two: 'wave_race' is everything add_duels.sql already
-- describes (unaffected by this migration, stays the default so existing rows
-- and the existing async flow need no backfill). 'face_off' duels use the same
-- row for staking/invite/history, but skip the run-token/score columns
-- entirely — resolution comes from a live match ending, not two async submits.
--
-- `arena_room_id` is set once a face_off duel's two players connect over the
-- realtime WS route and get paired into a room, so a reconnect can rejoin the
-- same room instead of re-queuing.
ALTER TABLE duels ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'wave_race';
ALTER TABLE duels ADD COLUMN IF NOT EXISTS arena_room_id TEXT;

CREATE INDEX IF NOT EXISTS idx_duels_mode ON duels (mode);

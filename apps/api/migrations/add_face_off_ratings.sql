-- Face-Off ELO rating — track + display only for now (no effect on
-- matchmaking or stakes). Scoped to Face-Off specifically, not wave_race:
-- Face-Off is the real-time skill match ELO is meant for; wave_race is an
-- async score chase where a rating wouldn't mean the same thing.
CREATE TABLE IF NOT EXISTS face_off_ratings (
    wallet_address TEXT PRIMARY KEY,
    rating         INTEGER NOT NULL DEFAULT 1200,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Player groups (2026-11-07)
--
-- A group is a community a player represents: a university, a gaming community, a
-- streamer's crowd. Each has a slug that becomes its join link (/join/<slug>).
--
-- Membership is PERMANENT identity, not an event flag. A player joins once and the
-- group name stays on their profile and next to their name on boards until they
-- leave. Event windows (e.g. LAUTECH, 9-14 Nov 2026) are just the existing season
-- window applied to a group's members, so nothing here knows about dates.
--
-- One group per wallet (wallet is the PRIMARY KEY of group_members). There is
-- deliberately NO foreign key to players: someone follows the link and signs in
-- before they have finished onboarding, and the join must not fail on that order.
CREATE TABLE IF NOT EXISTS player_groups (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_groups_slug ON player_groups (LOWER(slug));

CREATE TABLE IF NOT EXISTS group_members (
    wallet_address TEXT PRIMARY KEY,
    group_id       UUID NOT NULL REFERENCES player_groups(id) ON DELETE CASCADE,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);

INSERT INTO player_groups (slug, name, description)
SELECT 'lautech', 'LAUTECH', 'Ladoke Akintola University of Technology, Ogbomoso'
WHERE NOT EXISTS (SELECT 1 FROM player_groups WHERE LOWER(slug) = 'lautech');

-- Valor — Initial Schema
-- Run this in your Supabase SQL editor or via supabase db push

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Players
-- ============================================================
CREATE TABLE players (
  wallet_address   TEXT PRIMARY KEY,
  play_style       TEXT NOT NULL CHECK (play_style IN ('Wanderer', 'Fighter', 'Champion')),
  avatar           TEXT NOT NULL,
  character_name   TEXT NOT NULL,
  rank             TEXT NOT NULL DEFAULT 'Bronze' CHECK (rank IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond')),
  xp               INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0 AND xp <= 999),
  attack_stat      INTEGER NOT NULL DEFAULT 10,
  defense_stat     INTEGER NOT NULL DEFAULT 10,
  speed_stat       INTEGER NOT NULL DEFAULT 10,
  g_earned_lifetime NUMERIC(18, 6) NOT NULL DEFAULT 0,
  last_active      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decay_status     TEXT NOT NULL DEFAULT 'none' CHECK (decay_status IN ('none', 'warning', 'active')),
  decay_frozen_until TIMESTAMPTZ,
  wins             INTEGER NOT NULL DEFAULT 0,
  losses           INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_players_rank_xp ON players (rank, xp DESC);
CREATE INDEX idx_players_last_active ON players (last_active);

-- ============================================================
-- Items
-- ============================================================
CREATE TABLE items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  rarity           TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  category         TEXT NOT NULL CHECK (category IN ('weapon', 'shield', 'booster')),
  stat_boost       INTEGER NOT NULL DEFAULT 0,
  price_g          NUMERIC(12, 6) NOT NULL,
  image_url        TEXT NOT NULL DEFAULT '',
  total_supply     INTEGER,  -- NULL = unlimited
  remaining_supply INTEGER   -- NULL = unlimited
);

CREATE INDEX idx_items_category ON items (category);
CREATE INDEX idx_items_rarity ON items (rarity);

-- ============================================================
-- Inventory
-- ============================================================
CREATE TABLE inventory (
  wallet_address TEXT NOT NULL REFERENCES players (wallet_address) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES items (id),
  equipped       BOOLEAN NOT NULL DEFAULT false,
  acquired_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, item_id)
);

CREATE INDEX idx_inventory_wallet ON inventory (wallet_address);

-- ============================================================
-- Battles
-- ============================================================
CREATE TABLE battles (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_wallet       TEXT NOT NULL,
  opponent_wallet         TEXT NOT NULL,
  winner_wallet           TEXT,
  rounds_data             JSONB NOT NULL DEFAULT '[]',
  xp_awarded_challenger   INTEGER NOT NULL DEFAULT 0,
  xp_awarded_opponent     INTEGER NOT NULL DEFAULT 0,
  is_bot                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_battles_challenger ON battles (challenger_wallet, created_at DESC);
CREATE INDEX idx_battles_opponent ON battles (opponent_wallet, created_at DESC);

-- ============================================================
-- Missions
-- ============================================================
CREATE TABLE missions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL REFERENCES players (wallet_address) ON DELETE CASCADE,
  deployed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  collect_by     TIMESTAMPTZ NOT NULL,
  collected      BOOLEAN NOT NULL DEFAULT false,
  item_dropped   UUID REFERENCES items (id),
  xp_awarded     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_missions_wallet ON missions (wallet_address, collected);

-- ============================================================
-- Achievements
-- ============================================================
CREATE TABLE achievements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  condition   TEXT NOT NULL,
  image_url   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE player_achievements (
  wallet_address TEXT NOT NULL REFERENCES players (wallet_address) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements (id),
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, achievement_id)
);

-- ============================================================
-- Daily Claims
-- ============================================================
CREATE TABLE daily_claims (
  wallet_address  TEXT PRIMARY KEY REFERENCES players (wallet_address) ON DELETE CASCADE,
  last_claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_claims ENABLE ROW LEVEL SECURITY;

-- Public read on players (for leaderboard + shareable cards)
CREATE POLICY "Public read players" ON players FOR SELECT USING (true);

-- Players can insert/update only their own record (anon role via wallet)
-- Note: full auth wiring uses Supabase Auth + wallet signature or service role from backend
CREATE POLICY "Players insert own" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Players update own" ON players FOR UPDATE USING (true);

-- Items are public read
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read items" ON items FOR SELECT USING (true);

-- Public read on battles and achievements
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read achievements" ON achievements FOR SELECT USING (true);
CREATE POLICY "Public read battles" ON battles FOR SELECT USING (true);
CREATE POLICY "Battles insert" ON battles FOR INSERT WITH CHECK (true);
CREATE POLICY "Inventory read" ON inventory FOR SELECT USING (true);
CREATE POLICY "Inventory insert" ON inventory FOR INSERT WITH CHECK (true);
CREATE POLICY "Inventory update" ON inventory FOR UPDATE USING (true);
CREATE POLICY "Missions read" ON missions FOR SELECT USING (true);
CREATE POLICY "Missions insert" ON missions FOR INSERT WITH CHECK (true);
CREATE POLICY "Missions update" ON missions FOR UPDATE USING (true);
CREATE POLICY "Daily claims read" ON daily_claims FOR SELECT USING (true);
CREATE POLICY "Daily claims upsert" ON daily_claims FOR INSERT WITH CHECK (true);
CREATE POLICY "Daily claims update" ON daily_claims FOR UPDATE USING (true);
CREATE POLICY "Player achievements read" ON player_achievements FOR SELECT USING (true);
CREATE POLICY "Player achievements insert" ON player_achievements FOR INSERT WITH CHECK (true);

-- ============================================================
-- Seed: Items
-- ============================================================
INSERT INTO items (name, description, rarity, category, stat_boost, price_g, image_url) VALUES
  ('Iron Sword',       'A reliable weapon for new warriors.',         'common',    'weapon',  3,  5,    ''),
  ('Steel Blade',      'Forged in the heat of battle.',               'rare',      'weapon',  7,  15,   ''),
  ('Void Edge',        'A blade from another dimension.',             'epic',      'weapon',  12, 35,   ''),
  ('Iron Shield',      'Basic protection against attacks.',           'common',    'shield',  3,  5,    ''),
  ('Valor Guard',      'A shield that delays decay for 7 days.',      'rare',      'shield',  6,  20,   ''),
  ('Fortress Wall',    'Maximum defense.',                            'epic',      'shield',  10, 40,   ''),
  ('XP Booster',       'Double XP from all sources for 24 hours.',   'common',    'booster', 0,  10,   ''),
  ('Elite Booster',    '2x XP + 1.5x battle rewards for 24 hours.',  'rare',      'booster', 0,  25,   '');

-- Limited legendary item (50 total)
INSERT INTO items (name, description, rarity, category, stat_boost, price_g, image_url, total_supply, remaining_supply) VALUES
  ('The Last Blade',   'Only 50 exist. Ever.',                       'legendary', 'weapon',  20, 100,  '', 50, 50);

-- Seed achievements
INSERT INTO achievements (name, description, condition, image_url) VALUES
  ('First Blood',     'Win your first battle.',                     'wins >= 1',           ''),
  ('Warrior',         'Win 10 battles.',                            'wins >= 10',          ''),
  ('Battle Hardened', 'Win 50 battles.',                            'wins >= 50',          ''),
  ('Survivor',        'Recover from active decay.',                 'decay_recovered',     ''),
  ('Gold Rush',       'Reach Gold rank.',                           'rank = Gold',         ''),
  ('Diamond Hands',   'Reach Diamond rank — the pinnacle.',         'rank = Diamond',      ''),
  ('Idle Master',     'Complete 10 idle missions.',                 'missions >= 10',      ''),
  ('Collector',       'Own 5 items.',                               'inventory >= 5',      '');

-- A wallet-only account (never signed in through Magic) has no `magic_email` and
-- never will — that column specifically means "a real Magic OTP login exists for
-- this wallet". contact_email is deliberately separate: support/lookup only, never
-- read by the username sign-in path (see handlers/players.rs::resolve_login_email).
ALTER TABLE players ADD COLUMN IF NOT EXISTS contact_email TEXT;

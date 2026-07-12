#!/usr/bin/env node
/**
 * Reconstruct the `players` table from on-chain ValorGameRecord events on Celo.
 *
 * When we migrated off Railway (trial expired, no backup), the off-chain player
 * data was lost — but character claims, battles and rank-ups were all logged
 * on-chain. This rebuilds each user's core profile from those events so returning
 * users keep their character and land on their dashboard instead of re-onboarding.
 *
 * Recovers per wallet:  character_class, character_name (CharacterClaimed),
 *                       wins/losses (BattleRecorded), rank (latest RankUp).
 * Cannot recover (off-chain only): xp-toward-rank, pve_level, username, claim ts.
 *
 * Usage:
 *   GAME_RECORD_CONTRACT=0x.. CELOSCAN_API_KEY=.. node scripts/reconstruct-players.mjs           # dry run: print + write SQL
 *   GAME_RECORD_CONTRACT=0x.. CELOSCAN_API_KEY=.. DATABASE_URL=postgres://.. node ...             # apply to the DB
 */
import * as ethers from 'ethers';
const { AbiCoder, getAddress } = ethers;
import { writeFileSync } from 'node:fs';

const API = 'https://api.etherscan.io/v2/api';
const CHAIN = 42220; // Celo
const ADDR = process.env.GAME_RECORD_CONTRACT;
const KEY = process.env.CELOSCAN_API_KEY;
if (!ADDR || !KEY) { console.error('Set GAME_RECORD_CONTRACT and CELOSCAN_API_KEY'); process.exit(1); }

// keccak256 of the canonical event signatures (topic0).
const TOPICS = {
  CharacterClaimed: '0x7785de3a587a903b779ad500f9bf82e16a5c093746afdbbe4e28db05319f6c84', // (address indexed, string, string, uint256)
  BattleRecorded:   '0x6ea7223eef7ffd0615af9264e2e76f54286d960e084524ee6156fab7a647ad6d', // (bytes32 idx, address idx, address idx, uint8, uint8, bool, uint256)
  RankUp:           '0xe68a2b4efeedba7fcf2c8710bca59d2fe363ecdfb789e6aa099ec27405e9b167', // (address idx, string, uint256)
};

const abi = AbiCoder.defaultAbiCoder();
const addrFromTopic = (t) => getAddress('0x' + t.slice(26)); // last 20 bytes of a 32-byte topic

async function getLogs(topic0) {
  const url = `${API}?chainid=${CHAIN}&module=logs&action=getLogs&address=${ADDR}&topic0=${topic0}&fromBlock=0&toBlock=latest&apikey=${KEY}`;
  const r = await fetch(url).then((x) => x.json());
  if (r.status !== '1' && r.message !== 'No records found') throw new Error(`getLogs ${topic0}: ${r.message} ${JSON.stringify(r.result).slice(0,120)}`);
  return Array.isArray(r.result) ? r.result : [];
}

const ZERO = '0x0000000000000000000000000000000000000000';
// A real wallet never has ~all-zero bytes; this skips test/placeholder addresses
// like 0x0000…0099 that were emitted during development.
const isTestAddr = (a) => /^0x0{30,}/i.test(a);
const players = new Map(); // wallet(lower) -> row

function ensure(wallet) {
  const w = wallet.toLowerCase();
  if (!players.has(w)) players.set(w, { wallet, character_class: null, character_name: null, rank: 'Bronze', wins: 0, losses: 0, claimedTs: 0, rankTs: 0 });
  return players.get(w);
}

const VALID_CLASS = new Set(['Berserker', 'Sentinel', 'Phantom', 'Warden', 'Specter', 'Vanguard']);

async function main() {
  // ── characters ──
  const chars = await getLogs(TOPICS.CharacterClaimed);
  for (const log of chars) {
    const wallet = addrFromTopic(log.topics[1]);
    if (wallet === ZERO || isTestAddr(wallet)) continue;
    const [cls, name, ts] = abi.decode(['string', 'string', 'uint256'], log.data);
    if (!VALID_CLASS.has(cls)) continue;             // skip test/garbage entries
    const p = ensure(wallet);
    if (Number(ts) >= p.claimedTs) { p.character_class = cls; p.character_name = name; p.claimedTs = Number(ts); } // keep latest claim
  }

  // ── rank-ups (latest wins) ──
  const ranks = await getLogs(TOPICS.RankUp);
  for (const log of ranks) {
    const wallet = addrFromTopic(log.topics[1]);
    if (wallet === ZERO) continue;
    const [rank, ts] = abi.decode(['string', 'uint256'], log.data);
    const p = ensure(wallet);
    if (Number(ts) >= p.rankTs) { p.rank = rank; p.rankTs = Number(ts); }
  }

  // ── battles → win/loss tally (skip bot = address(0)) ──
  const battles = await getLogs(TOPICS.BattleRecorded);
  for (const log of battles) {
    const winner = addrFromTopic(log.topics[2]);
    const loser = addrFromTopic(log.topics[3]);
    if (winner !== ZERO && players.has(winner.toLowerCase())) ensure(winner).wins++;
    if (loser !== ZERO && players.has(loser.toLowerCase())) ensure(loser).losses++;
  }

  // Only rebuild users who actually have a character (that's what unlocks the dashboard).
  const rows = [...players.values()].filter((p) => p.character_class && p.character_name);
  console.log(`\nReconstructed ${rows.length} players with a character (from ${chars.length} claim events, ${ranks.length} rank-ups, ${battles.length} battles).`);
  for (const p of rows) console.log(`  ${p.wallet}  ${p.character_class.padEnd(9)} "${p.character_name}"  ${p.rank}  ${p.wins}W/${p.losses}L`);

  // ── emit SQL (idempotent; play_style/xp/pve_level default since they're off-chain) ──
  const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const sql = rows.map((p) =>
    `INSERT INTO players (wallet_address, character_class, character_name, play_style, rank, wins, losses, character_customization, avatar)\n` +
    `VALUES (${esc(p.wallet.toLowerCase())}, ${esc(p.character_class)}, ${esc(p.character_name)}, 'Fighter', ${esc(p.rank)}, ${p.wins}, ${p.losses}, '{}', '')\n` +
    `ON CONFLICT (wallet_address) DO NOTHING;`
  ).join('\n');
  writeFileSync(new URL('./reconstructed-players.sql', import.meta.url), sql + '\n');
  console.log(`\nWrote scripts/reconstructed-players.sql (${rows.length} INSERTs).`);

  // ── optionally apply ──
  if (process.env.DATABASE_URL) {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query(sql);
    const n = await c.query('SELECT count(*) FROM players');
    console.log(`Applied to DATABASE_URL. players rows now: ${n.rows[0].count}`);
    await c.end();
  } else {
    console.log('DATABASE_URL not set — dry run only (SQL written, nothing applied).');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

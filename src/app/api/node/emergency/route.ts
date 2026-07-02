/**
 * POST /api/node/emergency
 * 
 * Called by top miners when primary server is down.
 * Validates miner score, collects BFT votes (3/5),
 * publishes emergency block to @eastchainledger channel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';
import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { publishEmergencyBlock } from '@/lib/gossip';
import { createHash } from 'crypto';

const EMERGENCY_QUORUM   = 3; // 3 of top 5 miners must agree
const TOP_MINER_COUNT    = 5;
const VOTE_WINDOW_MS     = 30 * 60 * 1000; // 30 minutes

// In-memory vote collection (resets on server restart)
// In production, store in Redis for persistence
const emergencyVotes = new Map<string, {
  blockIndex: number;
  prevHash: string;
  minerAddress: string;
  reward: number;
  timestamp: number;
  voters: Set<string>;
  published: boolean;
  expiresAt: number;
}>();

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { tgId, initData, prevHash, reward = 10 } = body;

  // Verify Telegram identity
  if (process.env.NODE_ENV === 'production') {
    if (!initData || !validateTelegramData(initData))
      return NextResponse.json({ error: 'IDENTITY_VIOLATION' }, { status: 401 });
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== tgId)
      return NextResponse.json({ error: 'IDENTITY_MISMATCH' }, { status: 401 });
  }

  const identityClient = await identityPool.connect();
  const ledgerClient   = await ledgerPool.connect();

  try {
    // Check if miner is in top 5 by score
    const minerRes = await identityClient.query(`
      SELECT u.telegram_id, u.wallet_address, v.total_score
      FROM identity.users u
      LEFT JOIN identity.validators v ON v.telegram_id = u.telegram_id
      WHERE u.telegram_id = $1
    `, [tgId]);

    const miner = minerRes.rows[0];
    if (!miner) return NextResponse.json({ error: 'MINER_NOT_FOUND' }, { status: 404 });

    // Get top 5 miners by score
    const topRes = await identityClient.query(`
      SELECT telegram_id FROM identity.validators
      ORDER BY total_score DESC LIMIT $1
    `, [TOP_MINER_COUNT]);

    const topIds = topRes.rows.map((r: any) => r.telegram_id);
    if (!topIds.includes(tgId))
      return NextResponse.json({ error: 'NOT_TOP_MINER', message: 'Only top 5 miners can produce emergency blocks' }, { status: 403 });

    // Get last known block
    const lastBlockRes = await ledgerClient.query(`
      SELECT block_index, block_hash FROM ledger.blocks
      ORDER BY chain_seq DESC LIMIT 1
    `);
    const lastBlock    = lastBlockRes.rows[0];
    const blockIndex   = (lastBlock?.block_index ?? -1) + 1;
    const actualPrev   = lastBlock?.block_hash || 'GENESIS';

    // If prevHash provided, verify it matches
    if (prevHash && prevHash !== actualPrev)
      return NextResponse.json({ error: 'PREV_HASH_MISMATCH', expected: actualPrev }, { status: 409 });

    // Generate round key for this block index
    const roundKey = `emergency_${blockIndex}`;
    const now = Date.now();

    // Initialize vote round if not exists
    if (!emergencyVotes.has(roundKey)) {
      const blockHash = '0x' + createHash('sha256')
        .update(`EMERGENCY_${blockIndex}_${actualPrev}_${now}`)
        .digest('hex');

      emergencyVotes.set(roundKey, {
        blockIndex,
        prevHash: actualPrev,
        minerAddress: miner.wallet_address,
        reward,
        timestamp: now,
        voters: new Set(),
        published: false,
        expiresAt: now + VOTE_WINDOW_MS,
      });
    }

    const round = emergencyVotes.get(roundKey)!;

    // Check if vote window expired
    if (now > round.expiresAt) {
      emergencyVotes.delete(roundKey);
      return NextResponse.json({ error: 'VOTE_WINDOW_EXPIRED' }, { status: 410 });
    }

    // Already published
    if (round.published)
      return NextResponse.json({ success: true, status: 'already_published', blockIndex: round.blockIndex });

    // Record this miner's vote
    round.voters.add(tgId);
    const voteCount = round.voters.size;

    // Check if quorum reached
    if (voteCount >= EMERGENCY_QUORUM) {
      // Generate final block hash
      const blockHash = '0x' + createHash('sha256')
        .update(`EMERGENCY_${round.blockIndex}_${round.prevHash}_${round.timestamp}_${Array.from(round.voters).sort().join(',')}`)
        .digest('hex');

      // Publish to Telegram Channel
      await publishEmergencyBlock({
        blockIndex:   round.blockIndex,
        blockHash,
        prevHash:     round.prevHash,
        minerTgId:    tgId,
        minerAddress: round.minerAddress,
        reward:       round.reward,
        timestamp:    round.timestamp,
        votes:        voteCount,
        quorum:       EMERGENCY_QUORUM,
      });

      round.published = true;

      return NextResponse.json({
        success:    true,
        status:     'published',
        blockIndex: round.blockIndex,
        blockHash,
        votes:      voteCount,
        quorum:     EMERGENCY_QUORUM,
        message:    `Emergency block #${round.blockIndex} published to @eastchainledger`,
      });
    }

    return NextResponse.json({
      success:    true,
      status:     'vote_recorded',
      blockIndex: round.blockIndex,
      votes:      voteCount,
      quorum:     EMERGENCY_QUORUM,
      remaining:  EMERGENCY_QUORUM - voteCount,
      message:    `Vote recorded. ${EMERGENCY_QUORUM - voteCount} more needed.`,
    });

  } finally {
    identityClient.release();
    ledgerClient.release();
  }
}

export async function GET() {
  // Return current emergency vote status
  const rounds = Array.from(emergencyVotes.entries()).map(([key, round]) => ({
    roundKey: key,
    blockIndex: round.blockIndex,
    votes: round.voters.size,
    quorum: EMERGENCY_QUORUM,
    published: round.published,
    expiresIn: Math.max(0, round.expiresAt - Date.now()),
  }));

  return NextResponse.json({
    activeRounds: rounds,
    quorum: EMERGENCY_QUORUM,
    topMinerCount: TOP_MINER_COUNT,
    channel: '@eastchainledger',
  });
}

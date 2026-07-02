// POST /api/empty-block — Seal empty block (triggered by QStash every 30 min)
// Only creates block if active validator exists
import { NextRequest, NextResponse } from 'next/server';
import { ledgerPool } from '@/lib/db/ledger';
import { identityPool } from '@/lib/db/identity';
import { computeBlockHash, computeSequenceHash, computeMerkleRoot } from '@/lib/block-engine';
import { getNetworkStatus } from '@/lib/db/redis';
import { Receiver } from '@upstash/qstash';

async function verifyQStashSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const signature = req.headers.get('upstash-signature');
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!signature || !currentKey) return false;

  try {
    const receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey || currentKey,
    });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const secret = req.headers.get('x-cron-secret');
  const isAdmin = secret === process.env.ADMIN_SECRET;
  const isQStash = await verifyQStashSignature(req, rawBody);

  if (process.env.NODE_ENV === 'production' && !isAdmin && !isQStash) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check network status
  const status = await getNetworkStatus();
  if (status === 'halted') {
    return NextResponse.json({ skipped: true, reason: 'NETWORK_HALTED' });
  }

  // Check if active validator exists (Opsi 2 — validator required)
  const identityClient = await identityPool.connect();
  const ledgerClient = await ledgerPool.connect();

  try {
    const validatorRes = await identityClient.query(
      'SELECT telegram_id FROM identity.validators WHERE is_active = TRUE ORDER BY total_score DESC LIMIT 1'
    );

    if (!validatorRes.rows.length) {
      return NextResponse.json({ skipped: true, reason: 'NO_ACTIVE_VALIDATOR' });
    }

    const validatorId = validatorRes.rows[0].telegram_id;

    // Get last block
    const lastBlock = await ledgerClient.query(
      'SELECT block_index, block_hash, sequence_hash FROM ledger.blocks ORDER BY chain_seq DESC LIMIT 1'
    );
    const prevHash = lastBlock.rows[0]?.block_hash || 'GENESIS';
    const blockIndex = lastBlock.rows.length > 0 ? lastBlock.rows[0].block_index + 1 : 0;
    const timestamp = Date.now();

    const merkleRoot = computeMerkleRoot([]);
    const sequenceHash = computeSequenceHash(prevHash, blockIndex, timestamp);
    const blockHash = computeBlockHash(prevHash, blockIndex, merkleRoot, timestamp, 0);

    await ledgerClient.query(`
      INSERT INTO ledger.blocks
        (block_index, block_hash, prev_hash, sequence_hash, merkle_root,
         tx_count, total_gas, is_empty, validator_id)
      VALUES ($1,$2,$3,$4,$5,0,0,TRUE,$6)
    `, [blockIndex, blockHash, prevHash, sequenceHash, merkleRoot, validatorId]);

    // Set genesis if first block
    if (blockIndex === 0) {
      await ledgerClient.query(`
        INSERT INTO ledger.chain_meta (key, value)
        VALUES ('genesis_timestamp', $1) ON CONFLICT (key) DO NOTHING
      `, [new Date(timestamp).toISOString()]);
    }

    console.log(`[EASTCHAIN] Empty block #${blockIndex} sealed by validator ${validatorId}`);

    return NextResponse.json({
      success: true,
      blockIndex,
      blockHash,
      sequenceHash,
      validatorId,
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] Empty block error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    identityClient.release();
    ledgerClient.release();
  }
}

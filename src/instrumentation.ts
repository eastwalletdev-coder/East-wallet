/**
 * Next.js instrumentation — runs once on server startup
 * Initializes DB schema, runs PoC epoch, starts schedulers
 * Phase C: Recovery sync from @eastchainledger on startup
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const {
      initIdentitySchema, migrateIdentityV2, migrateIdentityV3, migrateIdentityV4,
      migrateIdentityV5, migrateIdentityV6, migrateIdentityV7, backfillKeypairs,
      hasStartupChainCompleted, markStartupChainCompleted,
    } = await import('@/lib/db/identity');
    const { initLedgerSchema, migrateSchemaV2, migrateLedgerV3, migrateLedgerV4, migrateLedgerV5, migrateLedgerV6, migrateContractSchema } = await import('@/lib/db/ledger');
    const { runEpoch } = await import('@/lib/poc-engine');

    // Everything below touches NeonDB. If the DB is briefly unreachable on
    // cold start (e.g. Neon waking from idle-suspend, or a transient
    // network blip), a thrown error here must NOT crash the whole
    // serverless instance — that would take down unrelated requests
    // (e.g. /api/cooldown) that have nothing to do with schema setup.
    try {
      // Schema init + every migrateXxx() below only need to actually run
      // ONCE per deployment — they used to re-run this full 13+ round-trip
      // chain on every cold start (every fresh/idle serverless instance),
      // which was blocking requests to rarely-warm routes (e.g.
      // /api/archive/blocks/[height]) long enough to hit Vercel's function
      // timeout and 504. hasStartupChainCompleted()/markStartupChainCompleted()
      // gate this behind a flag row so a warm-but-not-yet-flagged deploy
      // still runs it exactly once, and every cold start after that skips
      // straight past it.
      const alreadyDone = await hasStartupChainCompleted();

      if (!alreadyDone) {
        await initIdentitySchema();
        await initLedgerSchema();
        await migrateIdentityV2();
        await migrateSchemaV2();
        await migrateLedgerV3();
        await migrateLedgerV4();
        await migrateLedgerV5();
        await migrateLedgerV6();
        await migrateIdentityV3();
        await migrateIdentityV4();
        await migrateIdentityV5();
        await migrateIdentityV6();
        await migrateIdentityV7();
        await migrateContractSchema();
        await markStartupChainCompleted();
        console.log('[EASTCHAIN] Startup schema chain completed — will be skipped on future cold starts');
      }

      // Everything below is non-critical background work — fire-and-forget
      // (not awaited) so it never blocks THIS instance's first request,
      // which is what turned a slow keypair backfill / channel recovery /
      // epoch run into a request-blocking 504 before. Each already has its
      // own non-fatal error handling.
      backfillKeypairs()
        .then(({ updated, total }) => {
          if (total > 0) console.log(`[EASTCHAIN] Keypair backfill — ${updated}/${total} users updated`);
        })
        .catch((err) => console.error('[EASTCHAIN] Keypair backfill error (non-fatal):', err));

      // Phase C: Recovery sync from @eastchainledger
      recoverFromChannel().catch((err) => {
        console.error('[EASTCHAIN] Channel recovery sync error (non-fatal):', err);
      });

      // Run first epoch on startup
      runEpoch()
        .then(() => console.log('[EASTCHAIN] Server initialized — PoC epoch scheduler active'))
        .catch((err) => console.error('[EASTCHAIN] Startup epoch run error (non-fatal):', err));
    } catch (err) {
      // Schema init / migration failed (most likely a DB connection
      // error) BEFORE markStartupChainCompleted() ran — the flag was
      // never set, so this naturally retries on the next cold start.
      // Log it loudly but let the function continue serving requests —
      // individual routes already guard their own DB calls, so a failed
      // startup pass here shouldn't take the whole app down.
      console.error('[EASTCHAIN] Startup initialization failed (non-fatal, will retry next cold start):', err);
    }

    // Schedule PoC epoch every 24 hours
    setInterval(async () => {
      try {
        const { runEpoch } = await import('@/lib/poc-engine');
        await runEpoch();
      } catch (err) {
        console.error('[EASTCHAIN] Epoch scheduler error:', err);
      }
    }, 24 * 60 * 60 * 1000);
  }
}

/**
 * Recovery sync — read emergency blocks from @eastchainledger
 * and commit any blocks that were created while server was offline
 */
async function recoverFromChannel() {
  const { ledgerPool } = await import('@/lib/db/ledger');
  const { fetchChannelHistory, publishServerRecovery } = await import('@/lib/gossip');

  const client = await ledgerPool.connect();
  try {
    // Get last known message ID from DB
    const metaRes = await client.query(
      "SELECT value FROM ledger.chain_meta WHERE key = 'last_channel_message_id'"
    );
    const lastMessageId = parseInt(metaRes.rows[0]?.value || '0');

    // Get last block index
    const lastBlockRes = await client.query(
      'SELECT block_index, block_hash FROM ledger.blocks ORDER BY chain_seq DESC LIMIT 1'
    );
    const lastBlockIndex = lastBlockRes.rows[0]?.block_index ?? -1;

    // Fetch emergency blocks from channel
    const emergencyBlocks = await fetchChannelHistory(lastMessageId);
    if (emergencyBlocks.length === 0) {
      console.log('[EASTCHAIN] Channel sync: no emergency blocks to recover');
      return;
    }

    // Filter only blocks newer than our last known block
    const newBlocks = emergencyBlocks.filter(b => b.blockIndex > lastBlockIndex);
    if (newBlocks.length === 0) {
      console.log('[EASTCHAIN] Channel sync: chain already up to date');
      return;
    }

    console.log(`[EASTCHAIN] Channel recovery: found ${newBlocks.length} emergency blocks to sync`);

    // Commit emergency blocks to ledger
    let synced = 0;
    for (const block of newBlocks.sort((a, b) => a.blockIndex - b.blockIndex)) {
      try {
        await client.query('BEGIN');

        await client.query(`
          INSERT INTO ledger.blocks
            (block_index, block_hash, prev_hash, sequence_hash, tx_count, total_gas, is_empty)
          VALUES ($1, $2, $3, $4, 0, 0, FALSE)
          ON CONFLICT (block_hash) DO NOTHING
        `, [block.blockIndex, block.blockHash || `0xEMERGENCY_${block.blockIndex}`,
            block.prevHash || 'EMERGENCY_PREV', block.blockHash || `0xSEQ_${block.blockIndex}`]);

        await client.query(`
          INSERT INTO ledger.chain_meta (key, value)
          VALUES ('lastBlockHash', $1)
          ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [block.blockHash]);

        await client.query('COMMIT');
        synced++;
      } catch {
        await client.query('ROLLBACK').catch(() => {});
      }
    }

    // Save last processed message ID
    const lastMsg = emergencyBlocks[emergencyBlocks.length - 1];
    await client.query(`
      INSERT INTO ledger.chain_meta (key, value)
      VALUES ('last_channel_message_id', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [String(lastMsg.messageId)]);

    // Announce recovery to channel
    if (synced > 0) {
      const newLastBlock = lastBlockIndex + synced;
      await publishServerRecovery(synced, newLastBlock);
      console.log(`[EASTCHAIN] Channel recovery complete: synced ${synced} blocks, chain head #${newLastBlock}`);
    }
  } finally {
    client.release();
  }
}

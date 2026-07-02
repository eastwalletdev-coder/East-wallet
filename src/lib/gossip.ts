/**
 * EASTCHAIN — Telegram Gossip Protocol
 * Sends notifications to top N active validators via Telegram Bot (N = TOP_VALIDATORS)
 * Used for: fault recovery votes, epoch announcements, network alerts
 * 
 * Phase C: Telegram Channel Emergency Ledger
 * @eastchainledger = public backup chain when server is down
 */

import { getTopValidators, TOP_VALIDATORS, VALIDATOR_QUORUM } from './poc-engine';

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_API     = `https://api.telegram.org/bot${BOT_TOKEN}`;
const CHANNEL_ID  = process.env.TELEGRAM_CHANNEL_ID || '@eastchainledger';

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const res = await fetch(`${BOT_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch { return false; }
}

// ── Channel Emergency Ledger ──────────────────────────────────────────────────

/**
 * Publish every new block to @eastchainledger
 * Called after every successful block seal (mining, transfer, staking, etc.)
 */
export async function publishBlockToChannel(block: {
  blockIndex: number;
  blockHash: string;
  prevHash: string;
  minerAddress: string;
  txType: string;
  amount: number;
  timestamp: number;
  totalMinted?: number;
}): Promise<boolean> {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;

  const time = new Date(block.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const supplyLine = block.totalMinted
    ? `\n💰 Supply: <code>${block.totalMinted.toLocaleString()} / 1,000,000,000 EAST</code>`
    : '';

  const text = [
    `🔗 <b>EASTCHAIN BLOCK #${block.blockIndex}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📦 Hash: <code>${block.blockHash.slice(0, 18)}...${block.blockHash.slice(-8)}</code>`,
    `⬅️ Prev: <code>${block.prevHash.slice(0, 18)}...${block.prevHash.slice(-8)}</code>`,
    `⛏️ Miner: <code>${block.minerAddress.slice(0, 10)}...${block.minerAddress.slice(-6)}</code>`,
    `🏷️ Type: <b>${block.txType}</b>`,
    `💎 Amount: <b>${block.amount} EAST</b>`,
    `🕐 Time: ${time}`,
    supplyLine,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `<i>EASTCHAIN Hybrid Consensus Ledger</i>`,
  ].filter(Boolean).join('\n');

  return sendTelegramMessage(CHANNEL_ID, text);
}

/**
 * Publish epoch seal to channel — immutable proof of validator election
 */
export async function publishEpochToChannel(epoch: {
  epochNumber: number;
  merkleRoot: string;
  validatorCount: number;
  topValidators: string[];
}): Promise<boolean> {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;

  const text = [
    `📊 <b>EASTCHAIN EPOCH #${epoch.epochNumber} SEALED</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🌳 Merkle Root: <code>${epoch.merkleRoot.slice(0, 20)}...</code>`,
    `👥 Active Validators: <b>${epoch.validatorCount}</b>`,
    `🏆 Top 3 Nodes:`,
    ...epoch.topValidators.slice(0, 3).map((id, i) => `  ${i + 1}. <code>${id}</code>`),
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `<i>Epoch sealed on-chain — tamper-proof</i>`,
  ].join('\n');

  return sendTelegramMessage(CHANNEL_ID, text);
}

/**
 * Emergency mode — server down, top miners broadcast blocks to channel
 * Called when /api/node/emergency receives a valid emergency block
 */
export async function publishEmergencyBlock(block: {
  blockIndex: number;
  blockHash: string;
  prevHash: string;
  minerTgId: string;
  minerAddress: string;
  reward: number;
  timestamp: number;
  votes: number;
  quorum: number;
}): Promise<boolean> {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;

  const text = [
    `🚨 <b>EASTCHAIN EMERGENCY BLOCK #${block.blockIndex}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📦 Hash: <code>${block.blockHash.slice(0, 18)}...${block.blockHash.slice(-8)}</code>`,
    `⬅️ Prev: <code>${block.prevHash.slice(0, 18)}...${block.prevHash.slice(-8)}</code>`,
    `⛏️ Miner: <code>${block.minerAddress.slice(0, 10)}...${block.minerAddress.slice(-6)}</code>`,
    `💎 Reward: <b>${block.reward} EAST</b>`,
    `🕐 Time: ${new Date(block.timestamp).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `✅ Votes: <b>${block.votes}/${block.quorum}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ <i>Emergency block — server offline, community validated</i>`,
  ].join('\n');

  return sendTelegramMessage(CHANNEL_ID, text);
}

/**
 * Notify channel that server is back online and syncing from channel history
 */
export async function publishServerRecovery(
  syncedBlocks: number,
  lastBlockIndex: number
): Promise<boolean> {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;

  const text = [
    `✅ <b>EASTCHAIN SERVER RESTORED</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔄 Synced <b>${syncedBlocks}</b> emergency blocks from channel`,
    `📦 Chain head: <b>#${lastBlockIndex}</b>`,
    `🟢 Network status: <b>ACTIVE</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `<i>Primary server restored. Normal operation resumed.</i>`,
  ].join('\n');

  return sendTelegramMessage(CHANNEL_ID, text);
}

/**
 * Fetch recent messages from channel for recovery sync
 * Returns parsed emergency blocks after server downtime
 */
export async function fetchChannelHistory(
  lastKnownMessageId: number = 0
): Promise<Array<{ messageId: number; blockIndex: number; blockHash: string; prevHash: string; minerAddress: string; reward: number; timestamp: number }>> {
  if (!BOT_TOKEN || !CHANNEL_ID) return [];
  try {
    const res = await fetch(
      `${BOT_API}/getUpdates?offset=${lastKnownMessageId + 1}&limit=100&allowed_updates=["channel_post"]`
    );
    const data = await res.json();
    if (!data.ok || !data.result?.length) return [];

    const blocks: any[] = [];
    for (const update of data.result) {
      const text = update.channel_post?.text || '';
      // Only parse EMERGENCY BLOCK messages
      if (!text.includes('EMERGENCY BLOCK')) continue;
      const blockMatch  = text.match(/EMERGENCY BLOCK #(\d+)/);
      const hashMatch   = text.match(/Hash: ([0-9a-fx]+\.{3}[0-9a-fx]+)/);
      const prevMatch   = text.match(/Prev: ([0-9a-fx]+\.{3}[0-9a-fx]+)/);
      const minerMatch  = text.match(/Miner: ([0-9a-fx]+\.{3}[0-9a-fx]+)/);
      const rewardMatch = text.match(/Reward: ([\d.]+) EAST/);
      const timeMatch   = text.match(/Time: (.+) UTC/);
      if (blockMatch) {
        blocks.push({
          messageId:    update.update_id,
          blockIndex:   parseInt(blockMatch[1]),
          blockHash:    hashMatch?.[1] || '',
          prevHash:     prevMatch?.[1] || '',
          minerAddress: minerMatch?.[1] || '',
          reward:       parseFloat(rewardMatch?.[1] || '0'),
          timestamp:    timeMatch ? new Date(timeMatch[1] + ' UTC').getTime() : Date.now(),
        });
      }
    }
    return blocks;
  } catch { return []; }
}

// ── Validator Notifications ───────────────────────────────────────────────────

export async function gossipToValidators(message: string): Promise<{ sent: number; failed: number }> {
  const validators = await getTopValidators();
  if (validators.length === 0) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (const validator of validators) {
    const ok = await sendTelegramMessage(validator.telegram_id, message);
    if (ok) sent++; else failed++;
  }
  console.log(`[EASTCHAIN Gossip] Notified ${sent}/${validators.length} validators`);
  return { sent, failed };
}

export async function notifyRecoveryVote(corruptedBlockIndex: number, detectedAt: string): Promise<void> {
  const message = `
🔴 <b>EASTCHAIN NETWORK ALERT</b>

⚠️ Chain integrity anomaly detected.
📦 Block: <code>#${corruptedBlockIndex}</code>
🕐 Detected: ${detectedAt}

<b>Action Required:</b>
Open EAST app → tap "Approve Recovery" to vote.

Quorum needed: ${VALIDATOR_QUORUM}/${TOP_VALIDATORS} validators
Voting window: 24 hours

<i>This is an automated message from EAST Anchor Protocol.</i>
  `.trim();
  await gossipToValidators(message);
}

export async function notifyNewEpoch(epochNumber: number, validatorCount: number, yourRank?: number): Promise<void> {
  const rankMsg = yourRank ? `\n🏆 Your rank: <b>#${yourRank}</b>` : '';
  const message = `
✅ <b>EASTCHAIN Epoch Update</b>

📊 Epoch #${epochNumber} validator election complete.
👥 Active validators: ${validatorCount}/${TOP_VALIDATORS}${rankMsg}

Keep mining and staking to maintain your validator status.

<i>EAST Proof of Contribution Protocol</i>
  `.trim();
  await gossipToValidators(message);
}

export async function notifyNetworkHalted(reason: string): Promise<void> {
  const message = `
🚨 <b>EASTCHAIN NETWORK HALTED</b>

The EAST hybrid ledger has been temporarily paused.

Reason: ${reason}

Open EAST app for recovery voting.
Your vote is needed to restore the network.

<i>EAST Anchor Protocol</i>
  `.trim();
  await gossipToValidators(message);
  // Also notify channel
  await sendTelegramMessage(CHANNEL_ID, message);
}

export async function notifyRecoverySuccess(votesFor: number, totalValidators: number): Promise<void> {
  const message = `
✅ <b>EASTCHAIN Network Restored</b>

Consensus reached: ${votesFor}/${totalValidators} validators approved.
The EAST hybrid ledger is now active.

Thank you for participating in network governance.

<i>EAST PoC Consensus</i>
  `.trim();
  await gossipToValidators(message);
  await sendTelegramMessage(CHANNEL_ID, message);
}


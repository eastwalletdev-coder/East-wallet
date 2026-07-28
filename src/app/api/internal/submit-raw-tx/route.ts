// POST /api/internal/submit-raw-tx
//
// Internal-only — called by the standalone east-rpc server after it
// forwards a MetaMask eth_sendRawTransaction call here. Never call this
// directly from a browser/MetaMask; east-rpc is the only intended caller,
// authenticated via a shared secret header (RPC_SERVER_SECRET, same value
// set in both this app's and east-rpc's env vars).
//
// This mirrors sendEast()'s transactional pattern in mining-actions.ts
// almost exactly (same balance-lock-then-queue shape, same recipient
// lookup via LOWER(wallet_address)) — the difference is identity: sendEast
// looks the SENDER up by telegram_id (Mini App call); this endpoint has no
// Telegram identity, only the wallet address ethers recovers from the raw
// transaction's signature, so the sender is looked up by
// LOWER(wallet_address) instead. Kept here rather than in east-rpc so the
// money-moving logic stays in exactly one place.
import { NextRequest, NextResponse } from 'next/server';
import { Transaction, formatEther } from 'ethers';
import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';
import { queueTransaction } from '@/lib/block-engine';
import { EAST_CHAIN_ID } from '@/lib/contracts/registry';
import { invalidateCachedUser } from '@/lib/db/redis';
import { notifyHubBalanceChanged } from '@/lib/hub-notify';

async function getGasPriceEast(): Promise<number> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(`SELECT value FROM ledger.chain_meta WHERE key = 'gas_price_east'`);
    const v = res.rows.length ? parseFloat(res.rows[0].value) : NaN;
    return Number.isFinite(v) && v >= 0 ? v : 0.01;
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get('x-rpc-server-secret');
  const expected = process.env.RPC_SERVER_SECRET;
  if (!expected || secretHeader !== expected) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rawTx = body?.rawTx;
  if (!rawTx) return NextResponse.json({ success: false, error: 'MISSING_RAW_TX' }, { status: 400 });

  let parsed: Transaction;
  try {
    parsed = Transaction.from(rawTx);
  } catch {
    return NextResponse.json({ success: false, error: 'MALFORMED_TRANSACTION' }, { status: 400 });
  }

  if (parsed.chainId !== BigInt(EAST_CHAIN_ID)) {
    return NextResponse.json({ success: false, error: `WRONG_NETWORK — expected chainId ${EAST_CHAIN_ID}` }, { status: 400 });
  }
  if (!parsed.from) {
    return NextResponse.json({ success: false, error: 'INVALID_SIGNATURE' }, { status: 400 });
  }
  if (!parsed.to) {
    return NextResponse.json({ success: false, error: 'CONTRACT_DEPLOYMENT_NOT_SUPPORTED' }, { status: 400 });
  }
  if (parsed.data && parsed.data !== '0x') {
    return NextResponse.json({ success: false, error: 'CONTRACT_CALL_NOT_SUPPORTED_VIA_RAW_TX' }, { status: 400 });
  }

  const senderAddress = parsed.from;
  const recipientAddress = parsed.to;
  const amount = Number(formatEther(parsed.value));
  if (!(amount > 0)) {
    return NextResponse.json({ success: false, error: 'AMOUNT_MUST_BE_POSITIVE' }, { status: 400 });
  }
  const gasFee = await getGasPriceEast();
  const totalDebit = amount + gasFee;

  const identityClient = await identityPool.connect();
  try {
    await identityClient.query('BEGIN');

    const senderRes = await identityClient.query(
      'SELECT telegram_id, wallet_address, balance FROM identity.users WHERE LOWER(wallet_address) = $1 FOR UPDATE',
      [senderAddress.toLowerCase()]
    );
    if (!senderRes.rows.length) {
      await identityClient.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'SENDER_NOT_REGISTERED' }, { status: 400 });
    }
    const sender = senderRes.rows[0];

    if (Number(sender.balance) < totalDebit) {
      await identityClient.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'INSUFFICIENT_BALANCE' }, { status: 400 });
    }

    const recipientRes = await identityClient.query(
      'SELECT telegram_id, wallet_address FROM identity.users WHERE LOWER(wallet_address) = $1 FOR UPDATE',
      [recipientAddress.toLowerCase()]
    );
    if (!recipientRes.rows.length) {
      await identityClient.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'RECIPIENT_NOT_FOUND' }, { status: 400 });
    }
    const recipient = recipientRes.rows[0];

    if (recipient.telegram_id === sender.telegram_id) {
      await identityClient.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'CANNOT_SEND_TO_SELF' }, { status: 400 });
    }

    // parsed.hash is the transaction's real keccak hash — using it as our
    // tx_hash means eth_getTransactionByHash/Receipt lookups by the hash
    // MetaMask shows the user actually resolve to this row, standard
    // Ethereum RPC behavior.
    const txHash = parsed.hash!;

    await identityClient.query(
      'UPDATE identity.users SET balance = balance - $1, updated_at = NOW() WHERE telegram_id = $2',
      [totalDebit, sender.telegram_id]
    );
    await identityClient.query('COMMIT');
    await invalidateCachedUser(sender.telegram_id);
    notifyHubBalanceChanged(sender.wallet_address, Number(sender.balance) - totalDebit);

    await queueTransaction({
      txHash,
      txType: 'TRANSFER',
      senderId: sender.telegram_id,
      recipientId: recipient.telegram_id,
      senderAddress: sender.wallet_address,
      recipientAddress: recipient.wallet_address,
      amount,
      gasFee,
      payload: { source: 'metamask_rpc' },
    });

    return NextResponse.json({ success: true, txHash });
  } catch (err: any) {
    await identityClient.query('ROLLBACK').catch(() => {});
    console.error('[EASTCHAIN] submit-raw-tx error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    identityClient.release();
  }
}

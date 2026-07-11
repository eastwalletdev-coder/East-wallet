"use client"

/**
 * EASTCHAIN — Multi-chain send service (client-only, real signing)
 * ─────────────────────────────────────────────────────────────────────
 * Everything here signs and broadcasts using keys derived entirely in
 * the browser (see wallet-service.ts) — the mnemonic/private key never
 * leaves the device, only the signed transaction (which is meant to be
 * public) gets sent out, straight to the RPC endpoint.
 */
import { parseEther, parseUnits, formatEther, Contract, isAddress } from 'ethers';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  type Keypair,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
} from '@solana/spl-token';
import { getEvmSigner, getSolanaKeypair } from './wallet-service';
import type { Wallet } from 'ethers';

export type SendResult =
  | { success: true; txHash: string }
  | { success: false; error: string };

export type FeeEstimate =
  | { success: true; fee: string; feeSymbol: string; nativeBalance: string; sufficientForFee: boolean }
  | { success: false; error: string };

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
];

/**
 * Estimates the network fee for an EVM send BEFORE the user confirms —
 * so "insufficient gas" shows up as a warning in the dialog, not a
 * broadcast failure after the fact. Checks the actual native balance
 * (ETH/BNB) since that's what pays gas, separate from whatever token
 * balance is being sent.
 */
export async function estimateEvmFee(params: {
  mnemonic: string;
  rpcUrl: string;
  toAddress: string;
  amount: string;
  contractAddress?: string;
  decimals?: number;
}): Promise<FeeEstimate> {
  const { mnemonic, rpcUrl, toAddress, amount, contractAddress, decimals = 18 } = params;
  if (!isAddress(toAddress)) return { success: false, error: 'INVALID_ADDRESS' };

  try {
    const signer = getEvmSigner(mnemonic, rpcUrl);
    const provider = signer.provider!;

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;

    let gasLimit: bigint;
    if (!contractAddress) {
      gasLimit = await provider.estimateGas({ from: signer.address, to: toAddress, value: parseEther(amount || '0') });
    } else {
      const contract = new Contract(contractAddress, ERC20_ABI, signer);
      const amountUnits = parseUnits(amount || '0', decimals);
      gasLimit = await contract.transfer.estimateGas(toAddress, amountUnits);
    }

    const feeWei = gasLimit * gasPrice;
    const feeEth = formatEther(feeWei);
    const nativeBalanceWei = await provider.getBalance(signer.address);
    const nativeBalanceEth = formatEther(nativeBalanceWei);

    // For a native send, gas is on top of the amount itself; for a token
    // send, gas is paid separately from the native balance regardless of
    // how much of the token is being sent.
    const requiredNative = !contractAddress ? parseFloat(feeEth) + parseFloat(amount || '0') : parseFloat(feeEth);

    return {
      success: true,
      fee: feeEth,
      feeSymbol: 'ETH', // BNB on BSC / ETH on Ethereum+Base — caller labels appropriately
      nativeBalance: nativeBalanceEth,
      sufficientForFee: parseFloat(nativeBalanceEth) >= requiredNative,
    };
  } catch (err: any) {
    console.error('[send-service] EVM fee estimate failed:', err);
    return { success: false, error: err?.shortMessage || err?.message || 'ESTIMATE_FAILED' };
  }
}

/**
 * Estimates the network fee for a Solana send. Solana fees are tiny and
 * mostly fixed (per-signature), but sending to a recipient's first-ever
 * associated token account for a given SPL mint also costs a one-time
 * rent-exemption deposit — that's the part users get surprised by, so
 * it's called out separately here.
 */
export async function estimateSolanaFee(params: {
  mnemonic: string;
  rpcUrl: string;
  toAddress: string;
  mintAddress?: string;
}): Promise<FeeEstimate> {
  const { mnemonic, rpcUrl, toAddress, mintAddress } = params;

  let recipient: PublicKey;
  try { recipient = new PublicKey(toAddress); } catch { return { success: false, error: 'INVALID_ADDRESS' }; }

  try {
    const keypair = getSolanaKeypair(mnemonic);
    const connection = new Connection(rpcUrl, 'confirmed');

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: keypair.publicKey, recentBlockhash: blockhash });

    let rentExemptionLamports = 0;
    if (mintAddress) {
      const mint = new PublicKey(mintAddress);
      const toAta = await getAssociatedTokenAddress(mint, recipient);
      try {
        await getAccount(connection, toAta);
      } catch {
        // Recipient's token account doesn't exist yet — this send would create it.
        rentExemptionLamports = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
        tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, toAta, recipient, mint));
      }
    } else {
      tx.add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: recipient, lamports: 0 }));
    }

    const feeResult = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
    const signatureFeeLamports = feeResult.value ?? 5000; // 5000 lamports/sig is Solana's long-standing base fee, used as a fallback if the RPC can't compute it
    const totalLamports = signatureFeeLamports + rentExemptionLamports;
    const feeSol = (totalLamports / LAMPORTS_PER_SOL).toString();

    const nativeBalanceLamports = await connection.getBalance(keypair.publicKey);
    const nativeBalanceSol = nativeBalanceLamports / LAMPORTS_PER_SOL;

    return {
      success: true,
      fee: feeSol,
      feeSymbol: 'SOL',
      nativeBalance: nativeBalanceSol.toString(),
      sufficientForFee: nativeBalanceLamports >= totalLamports,
    };
  } catch (err: any) {
    console.error('[send-service] Solana fee estimate failed:', err);
    return { success: false, error: err?.message || 'ESTIMATE_FAILED' };
  }
}

/**
 * Sends native (ETH/BNB/Base-ETH) or ERC20 tokens on any EVM chain.
 * `contractAddress` omitted = native transfer.
 */
export async function sendEvmTransaction(params: {
  mnemonic: string;
  rpcUrl: string;
  toAddress: string;
  amount: string;
  contractAddress?: string;
  decimals?: number;
}): Promise<SendResult> {
  const { mnemonic, rpcUrl, toAddress, amount, contractAddress, decimals = 18 } = params;

  if (!isAddress(toAddress)) {
    return { success: false, error: 'INVALID_ADDRESS' };
  }

  try {
    const signer = getEvmSigner(mnemonic, rpcUrl);

    if (!contractAddress) {
      // Native transfer
      const tx = await signer.sendTransaction({
        to: toAddress,
        value: parseEther(amount),
      });
      await tx.wait(1); // wait for 1 confirmation before reporting success
      return { success: true, txHash: tx.hash };
    }

    // ERC20 transfer
    const contract = new Contract(contractAddress, ERC20_ABI, signer);
    const amountUnits = parseUnits(amount, decimals);
    const tx = await contract.transfer(toAddress, amountUnits);
    await tx.wait(1);
    return { success: true, txHash: tx.hash };
  } catch (err: any) {
    console.error('[send-service] EVM send failed:', err);
    // ethers wraps a lot of failure modes — surface the most common ones clearly
    if (err?.code === 'INSUFFICIENT_FUNDS') return { success: false, error: 'INSUFFICIENT_BALANCE' };
    if (err?.code === 'CALL_EXCEPTION') return { success: false, error: 'TRANSACTION_REVERTED' };
    return { success: false, error: err?.shortMessage || err?.message || 'UNKNOWN_ERROR' };
  }
}

/**
 * Sends native SOL or an SPL token. `mintAddress` omitted = native SOL transfer.
 */
export async function sendSolanaTransaction(params: {
  mnemonic: string;
  rpcUrl: string;
  toAddress: string;
  amount: string;
  mintAddress?: string;
  decimals?: number;
}): Promise<SendResult> {
  const { mnemonic, rpcUrl, toAddress, amount, mintAddress, decimals = 6 } = params;

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(toAddress);
  } catch {
    return { success: false, error: 'INVALID_ADDRESS' };
  }

  try {
    const keypair: Keypair = getSolanaKeypair(mnemonic);
    const connection = new Connection(rpcUrl, 'confirmed');

    if (!mintAddress) {
      // Native SOL transfer
      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: recipient, lamports })
      );
      const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return { success: true, txHash: signature };
    }

    // SPL token transfer
    const mint = new PublicKey(mintAddress);
    const fromAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
    const toAta = await getAssociatedTokenAddress(mint, recipient);

    const tx = new Transaction();

    // Recipient may not have an associated token account yet — create one if missing.
    try {
      await getAccount(connection, toAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, toAta, recipient, mint));
    }

    const rawAmount = BigInt(Math.round(parseFloat(amount) * 10 ** decimals));
    tx.add(createTransferInstruction(fromAta, toAta, keypair.publicKey, rawAmount, [], TOKEN_PROGRAM_ID));

    const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
    return { success: true, txHash: signature };
  } catch (err: any) {
    console.error('[send-service] Solana send failed:', err);
    if (String(err?.message).includes('insufficient')) return { success: false, error: 'INSUFFICIENT_BALANCE' };
    return { success: false, error: err?.message || 'UNKNOWN_ERROR' };
  }
}

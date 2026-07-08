/**
 * EASTCHAIN — Transaction payload builders
 * ─────────────────────────────────────────────────────────────────────
 * Canonical formats for transaction payloads that get signed. MUST be
 * identical between client (who signs) and server (who verifies), or
 * signature verification will always fail.
 *
 * Exported so external scripts/validators can build the same payloads
 * their transactions need to sign.
 */

/**
 * SEND_EAST payload — for sendEast() function
 * Format: SEND_EAST|{telegramId}|{recipientAddress}|{amount}
 */
export function buildSendEastPayload(telegramId: string, recipientAddress: string, amount: number): string {
  return `SEND_EAST|${telegramId}|${recipientAddress.toLowerCase()}|${amount}`;
}

/**
 * STAKE_EAST payload — for stakeEast() function  
 * Format: STAKE_EAST|{telegramId}|{amount}
 */
export function buildStakeEastPayload(telegramId: string, amount: number): string {
  return `STAKE_EAST|${telegramId}|${amount}`;
}

/**
 * CLAIM_MINING payload — for claimMiningReward() function
 * Format: CLAIM_MINING|{telegramId}|{verifiedHeaders}
 */
export function buildClaimMiningPayload(telegramId: string, verifiedHeaders: number = 0): string {
  return `CLAIM_MINING|${telegramId}|${verifiedHeaders}`;
}

/**
 * CONTRACT_CALL payload — for any contract call via callContract()
 * Format: CONTRACT_CALL|{telegramId}|{contractAddress}|{functionName}|{paramsJson}
 */
export function buildContractCallPayload(
  telegramId: string,
  contractAddress: string,
  functionName: string,
  params: Record<string, any>
): string {
  return `CONTRACT_CALL|${telegramId}|${contractAddress}|${functionName}|${JSON.stringify(params)}`;
}

/**
 * EASTCHAIN — Transaction signing payload builder
 * Pure utility, intentionally NOT in a 'use server' file: everything
 * exported from a 'use server' module is treated by Next.js as a Server
 * Action, and Server Actions must be async. This is just string
 * formatting with no server secrets involved, so it lives here instead.
 */

export function buildTxSigningPayload(params: {
  senderAddress: string;
  recipientAddress: string;
  amount: number;
  txType: string;
  nonceOrTimestamp: number | string;
}): string {
  const { senderAddress, recipientAddress, amount, txType, nonceOrTimestamp } = params;
  return `${txType}|${senderAddress}|${recipientAddress}|${amount}|${nonceOrTimestamp}`;
}

"use client"

/**
 * EASTCHAIN — Real WalletConnect (Reown WalletKit) integration
 * ─────────────────────────────────────────────────────────────────────
 * Replaces the previous WalletConnectHandler.tsx, which was a pure
 * setTimeout simulation with hardcoded fake dApp metadata — scanning a
 * real WalletConnect URI from a real dApp did nothing real.
 *
 * WalletConnect rebranded to "Reown" — the wallet-side SDK is now
 * @reown/walletkit. Requires a free Project ID from
 * https://cloud.reown.com (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) — this
 * is a one-time manual registration step, not something that can be
 * generated programmatically.
 *
 * Scope: EVM chains only (Ethereum, Base, BSC — matches the chains this
 * wallet already signs real transactions for via send-service.ts).
 * WalletConnect's Solana support exists but is far less standardized
 * across dApps; left out of this first pass.
 */
import { Core } from '@walletconnect/core';
import { WalletKit, type WalletKitTypes } from '@reown/walletkit';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';

let walletKitInstance: InstanceType<typeof WalletKit> | null = null;
let initPromise: Promise<InstanceType<typeof WalletKit>> | null = null;

const SUPPORTED_EIP155_CHAINS = ['eip155:1', 'eip155:8453', 'eip155:56']; // Ethereum, Base, BSC
const SUPPORTED_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v4'];
const SUPPORTED_EVENTS = ['accountsChanged', 'chainChanged'];

export async function getWalletKit(): Promise<InstanceType<typeof WalletKit>> {
  if (walletKitInstance) return walletKitInstance;
  if (initPromise) return initPromise; // guard against double-init (React strict mode double-render)

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    throw new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — get a free Project ID at https://cloud.reown.com');
  }

  initPromise = (async () => {
    const core = new Core({ projectId });
    const kit = await WalletKit.init({
      core,
      metadata: {
        name: 'EASTCHAIN Wallet',
        description: 'Multi-chain wallet for EASTCHAIN',
        url: process.env.NEXT_PUBLIC_APP_URL || 'https://eastchain.app',
        icons: [],
      },
    });
    walletKitInstance = kit;
    return kit;
  })();

  return initPromise;
}

export async function pairWithUri(uri: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.pair({ uri });
}

/** Builds the namespaces to approve, offering our EVM address on every chain the dApp requested (that we support). */
export function buildNamespacesForApproval(
  proposal: WalletKitTypes.SessionProposal['params'],
  evmAddress: string
) {
  const requestedChains = [
    ...(proposal.requiredNamespaces?.eip155?.chains || []),
    ...(proposal.optionalNamespaces?.eip155?.chains || []),
  ];
  const chains = requestedChains.filter(c => SUPPORTED_EIP155_CHAINS.includes(c));
  const finalChains = chains.length > 0 ? chains : SUPPORTED_EIP155_CHAINS;

  return buildApprovedNamespaces({
    proposal,
    supportedNamespaces: {
      eip155: {
        chains: finalChains,
        methods: SUPPORTED_METHODS,
        events: SUPPORTED_EVENTS,
        accounts: finalChains.map(chain => `${chain}:${evmAddress}`),
      },
    },
  });
}

export async function approveSessionProposal(id: number, namespaces: ReturnType<typeof buildApprovedNamespaces>) {
  const kit = await getWalletKit();
  return kit.approveSession({ id, namespaces });
}

export async function rejectSessionProposal(id: number) {
  const kit = await getWalletKit();
  return kit.rejectSession({ id, reason: getSdkError('USER_REJECTED') });
}

export async function respondToRequest(topic: string, id: number, result: any) {
  const kit = await getWalletKit();
  return kit.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } });
}

export async function rejectRequest(topic: string, id: number, message = 'User rejected the request') {
  const kit = await getWalletKit();
  return kit.respondSessionRequest({
    topic,
    response: { id, jsonrpc: '2.0', error: { code: 5000, message } },
  });
}

export function getActiveSessions() {
  if (!walletKitInstance) return {};
  return walletKitInstance.getActiveSessions();
}

export async function disconnectSession(topic: string) {
  const kit = await getWalletKit();
  return kit.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
}

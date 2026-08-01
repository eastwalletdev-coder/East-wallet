/**
 * Phase 3 — read EAST balance from chain (east-validator) via Hub gateway
 * or direct validator URL. Neon identity.users.balance remains identity UX
 * cache until full cutover; when USE_CHAIN_BALANCE=true, UI should prefer
 * this source for display.
 *
 * Validator account JSON: { balance, staked, pending_unstake, nonce }
 * balance is 6-decimal subunits (1 EAST = 1_000_000).
 */

const SUBUNITS_PER_EAST = 1_000_000;

export type ChainAccount = {
  balance: number; // human EAST
  balanceSubunits: number;
  staked: number; // human EAST (validator stores 6-dec; we convert)
  stakedSubunits: number;
  pendingUnstake: number;
  pendingUnstakeSubunits: number;
  nonce: number;
  source: "hub" | "validator";
  raw: unknown;
};

function hubBase(): string {
  return (process.env.RAILWAY_HUB_URL || process.env.EAST_HUB_URL || "")
    .trim()
    .replace(/\/$/, "");
}

function validatorBase(): string {
  return (process.env.EAST_VALIDATOR_URL || process.env.VALIDATOR_HTTP_URL || "")
    .trim()
    .replace(/\/$/, "");
}

/** Prefer Hub /rpc/account (Phase 2 gateway); fall back to validator direct. */
export function chainReadConfigured(): boolean {
  return Boolean(hubBase() || validatorBase());
}

export function useChainBalanceEnabled(): boolean {
  // Explicit opt-in so production does not flip until Hub+validator are verified.
  return process.env.USE_CHAIN_BALANCE === "true" || process.env.USE_CHAIN_BALANCE === "1";
}

function subunitsToHuman(subunits: number): number {
  return subunits / SUBUNITS_PER_EAST;
}

export async function fetchChainAccount(
  address: string,
  opts?: { timeoutMs?: number },
): Promise<ChainAccount | null> {
  if (!address || !address.startsWith("0x")) return null;
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const addr = encodeURIComponent(address);

  const candidates: { url: string; source: "hub" | "validator" }[] = [];
  const hub = hubBase();
  const val = validatorBase();
  if (hub) candidates.push({ url: `${hub}/rpc/account/${addr}`, source: "hub" });
  if (val) candidates.push({ url: `${val}/account/${addr}`, source: "validator" });
  if (candidates.length === 0) return null;

  for (const c of candidates) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(c.url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ac.signal,
        cache: "no-store",
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as {
        balance?: number | string;
        staked?: number | string;
        pending_unstake?: number | string;
        nonce?: number | string;
      };
      const balanceSubunits = Number(raw.balance ?? 0);
      const stakedSubunits = Number(raw.staked ?? 0);
      const pendingUnstakeSubunits = Number(raw.pending_unstake ?? 0);
      if (!Number.isFinite(balanceSubunits)) continue;
      return {
        balanceSubunits,
        balance: subunitsToHuman(balanceSubunits),
        stakedSubunits,
        staked: subunitsToHuman(stakedSubunits),
        pendingUnstakeSubunits,
        pendingUnstake: subunitsToHuman(pendingUnstakeSubunits),
        nonce: Number(raw.nonce ?? 0) || 0,
        source: c.source,
        raw,
      };
    } catch {
      // try next candidate
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Merge chain balances into a mapped user object (from mapUserRow).
 * On failure / disabled flag, returns user unchanged and sets balanceSource.
 */
export async function applyChainBalanceToUser<T extends {
  walletAddress?: string | null;
  balance?: number;
  stakedAmount?: number;
  pendingUnstakeAmount?: number;
}>(user: T): Promise<T & { balanceSource?: string }> {
  if (!useChainBalanceEnabled() || !user?.walletAddress) {
    return { ...user, balanceSource: "neon" };
  }
  const chain = await fetchChainAccount(user.walletAddress);
  if (!chain) {
    return { ...user, balanceSource: "neon_fallback" };
  }
  return {
    ...user,
    balance: chain.balance,
    stakedAmount: chain.staked,
    pendingUnstakeAmount: chain.pendingUnstake,
    balanceSource: `chain:${chain.source}`,
  };
}

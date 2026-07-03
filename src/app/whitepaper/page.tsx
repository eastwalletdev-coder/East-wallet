"use client"

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/5 overflow-hidden bg-white/[0.03]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/5"
      >
        <span className="text-primary font-bold text-sm tracking-wide uppercase">{title}</span>
        {open
          ? <ChevronUp className="h-4 w-4 text-primary/60" />
          : <ChevronDown className="h-4 w-4 text-primary/60" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 text-white text-sm leading-relaxed space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-white/60">{label}</span>
      <span className="text-white font-bold">{value}</span>
    </div>
  );
}

export default function WhitepaperPage() {
  return (
    <div className="flex flex-col gap-4 px-3 py-4 pb-8">

      {/* Header */}
      <header className="flex items-center gap-3">
        <Link href="/profile">
          <Button variant="ghost" size="icon" className="text-white">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-primary font-extrabold uppercase tracking-widest text-base">EAST Whitepaper</h1>
          <p className="text-white/40 text-[10px] uppercase tracking-wider">v2.0 Technical Specification</p>
        </div>
      </header>

      {/* Tagline */}
      <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
        <CardContent className="p-4">
          <p className="text-primary font-bold text-base mb-1">One Smartphone, One Node, One Future</p>
          <p className="text-white text-sm leading-relaxed">
            EAST is a next-generation digital ecosystem designed to create a secure, transparent, and accessible financial infrastructure for everyone — directly from a smartphone.
          </p>
        </CardContent>
      </Card>

      {/* Sections */}
      <Section title="1. Abstract" defaultOpen>
        <p>EASTCHAIN is a hybrid ledger protocol designed for data consensus efficiency. Unlike traditional blockchains that store entire history on-chain forever, EASTCHAIN uses automatic pruning to maintain network scalability without compromising cryptographic integrity.</p>
        <p>The ecosystem is built on a dual-layer architecture — an Identity Layer for user validation and a Ledger Layer for all economic activity.</p>
      </Section>

      <Section title="2. Hybrid Architecture">
        <p className="text-white font-bold mb-1">Identity Layer (L1) — Relational Node/DB A</p>
        <p>Handles user registry, active balances, Telegram ID to wallet address mapping, validator management, cold storage archives, and referral tracking. Acts as the primary validation gateway.</p>
        <div className="my-2 border-t border-white/5" />
        <p className="text-white font-bold mb-1">Ledger Layer (L2) — Relational Node/DB B</p>
        <p>Stores transaction proof blocks using SHA-256 chaining. Only stores active data (last 30 days) before blocks are atomically migrated to Cold Storage in L1. Supply bucket enforcement ensures tokenomics caps are never exceeded.</p>
        <div className="my-2 border-t border-white/5" />
        <p className="text-white font-bold mb-1">Cache Layer — In-Memory Cache Node</p>
        <p>Handles 24-hour claim rate limiting, network status cache, and top-10 validator snapshots. Falls back gracefully to the primary Node/DB if the cache layer is unavailable.</p>
        <div className="my-2 border-t border-white/5" />
        <p className="text-white font-bold mb-1">Relay Layer — Light Node Hub</p>
        <p>A lightweight relay process forwards newly sealed block headers from the validator layer to all connected Light Nodes in real time, and carries heartbeat/participation signals back. It holds no permanent state and is not part of consensus.</p>
      </Section>

      <Section title="3. Rolling Archive & Pruning">
        <p>EASTCHAIN enforces a 30-day rolling cycle. Blocks older than 30 days are atomically migrated to Cold Storage in L1. The cryptographic chain is preserved via the last archived block hash reference (lastPrunedIndex).</p>
        <p>When a user queries a transaction older than 30 days, the explorer automatically falls back to the L1 archive — the chain appears seamless from the user's perspective.</p>
      </Section>

      <Section title="4. Proof of Contribution (PoC)">
        <p>EASTCHAIN selects up to 3 active validators each epoch (24 hours) — reduced from the planned 10 during this early testnet phase — using a composite score combining three pillars:</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <Row label="Proof of Stake (PoS)" value="Weight: 40%" />
          <Row label="Proof of Availability (PoA)" value="Weight: 35%" />
          <Row label="Proof of Reputation (PoR)" value="Weight: 25%" />
          <div className="border-t border-white/10 pt-2 mt-1">
            <p className="text-white/50 font-mono text-[11px]">Score = (Stake × 0.4) + (Uptime × 0.35) + (History × 0.25)</p>
          </div>
        </div>
        <p>Top 3 scores are automatically elected as active validators each epoch. Any user can become a validator — no special hardware required.</p>
      </Section>

      <Section title="5. Fault Recovery — Simplified BFT">
        <p>When a hash integrity anomaly is detected, the network enters RECOVERING mode. The system notifies the top 3 active validators via Telegram Bot gossip. A recovery vote is initiated with a 24-hour window.</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <Row label="Consensus Threshold" value="2 / 3 validators" />
          <Row label="Voting Window" value="24 hours" />
          <Row label="Gossip Channel" value="Telegram Bot" />
          <Row label="Fallback" value="Admin intervention" />
        </div>
        <p>The economy continues once 7 validators reach quorum — no permanent shutdown.</p>
      </Section>

      <Section title="6. Anchor Protocol">
        <p>A global state record (lastBlockHash) acts as a cryptographic anchor. Before any new block is written, the backend verifies the last active block's hash matches this anchor.</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Pre-mining audit on every block write</p>
          <p className="text-white/70 text-sm">→ Cross-layer hash verification (L1 ↔ L2)</p>
          <p className="text-white/70 text-sm">→ lastPrunedIndex checkpoint for full audit trail</p>
          <p className="text-white/70 text-sm">→ Attacker must corrupt L1 and L2 simultaneously to bypass</p>
        </div>
      </Section>

      <Section title="7. Tokenomics">
        <p className="text-white font-bold mb-2">Fixed Maximum Supply: 1,000,000,000 EAST</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Mining Rewards Pool" value="650,000,000 EAST" />
          <Row label="Liquidity Pool" value="100,000,000 EAST" />
          <Row label="Treasury" value="100,000,000 EAST" />
          <Row label="Founder (Vesting)" value="50,000,000 EAST" />
          <Row label="Marketing" value="50,000,000 EAST" />
          <Row label="Team" value="50,000,000 EAST" />
        </div>
        <p>All minting is enforced server-side via supply bucket validation. No token can be minted beyond its allocated cap.</p>
      </Section>

      <Section title="8. Referral Protocol">
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Bonus per referral" value="1 EAST" />
          <Row label="Trigger" value="4 claims by referred user" />
          <Row label="Lifetime cap" value="5,000 EAST" />
          <Row label="Registration" value="Auto via Telegram deep link" />
        </div>
      </Section>

      <Section title="9. Roadmap">
        <p className="text-white/50 text-[10px] uppercase font-bold mb-1">✓ Achieved</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mb-3">
          <p className="text-white/70 text-sm">→ Hybrid dual-layer ledger (SHA-256 chaining, Anchor Protocol)</p>
          <p className="text-white/70 text-sm">→ Proof of Contribution consensus (PoS + PoA + PoR)</p>
          <p className="text-white/70 text-sm">→ Native custodial wallet, deterministic from Telegram ID</p>
          <p className="text-white/70 text-sm">→ Smart-contract execution layer for Mining, Staking, Vesting — ABI whitelist, nonce protection, gas metering, signature verification</p>
          <p className="text-white/70 text-sm">→ EastPass tiers, staking-boosted mining, referral protocol</p>
          <p className="text-white/70 text-sm">→ Explorer with cross-layer search (block, tx, address, EAST ID)</p>
          <p className="text-white/70 text-sm">→ Fault recovery — validator governance voting for network incidents</p>
          <p className="text-white/70 text-sm">→ Light Node network — real-time header relay, client-side header verification, participation tracking</p>
        </div>

        <p className="text-white/50 text-[10px] uppercase font-bold mb-1">⚙ In Progress</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mb-3">
          <p className="text-white/70 text-sm">→ Light Node → Validator feedback loop: participation quorum contributing to block finality, not just passive observation</p>
          <p className="text-white/70 text-sm">→ Public RPC layer (balance/block/transaction queries) for external tooling</p>
          <p className="text-white/70 text-sm">→ External EVM wallet linking (bring-your-own-wallet, alongside the native custodial wallet)</p>
        </div>

        <p className="text-white/50 text-[10px] uppercase font-bold mb-1">◇ Planned — Q4</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5">
          <p className="text-white/70 text-sm">→ P2P Marketplace — peer-to-peer EAST trading with order book and escrowed settlement, natively inside the app</p>
        </div>
      </Section>

      <div className="text-center py-4 border-t border-white/5">
        <p className="text-primary font-bold text-xs uppercase tracking-widest">EASTCHAIN Protocol</p>
        <p className="text-white/30 text-[10px] mt-1">SHA-256 · Proof of Contribution · Anchor Protocol</p>
      </div>
    </div>
  );
}

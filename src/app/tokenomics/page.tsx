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

export default function TokenomicsPage() {
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
          <h1 className="text-primary font-extrabold uppercase tracking-widest text-base">EAST Tokenomics</h1>
          <p className="text-white/40 text-[10px] uppercase tracking-wider">Token Allocation & Economic Model</p>
        </div>
      </header>

      {/* Tagline */}
      <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
        <CardContent className="p-4">
          <p className="text-primary font-bold text-base mb-1">EAST — EastChain Mainnet</p>
          <p className="text-white text-sm leading-relaxed">
            A long-term sustainability model prioritizing ecosystem growth, decentralized participation, network security, and transparent treasury management. No additional tokens will ever be minted beyond the maximum supply of 1 billion EAST.
          </p>
        </CardContent>
      </Card>

      {/* Sections */}
      <Section title="1. Overview" defaultOpen>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Token Name" value="East (EAST)" />
          <Row label="Blockchain" value="EastChain Mainnet" />
          <Row label="Total Supply" value="1,000,000,000 EAST" />
        </div>
        <p className="text-white font-bold mt-2 mb-1">Consensus</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5">
          <p className="text-white/70 text-sm">→ Proof of Contribution (PoC)</p>
          <p className="text-white/70 text-sm">→ Proof of Stake (PoS)</p>
          <p className="text-white/70 text-sm">→ Proof of Availability (PoA)</p>
          <p className="text-white/70 text-sm">→ Proof of Reputation (PoR)</p>
        </div>
      </Section>

      <Section title="2. Token Allocation" defaultOpen>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Ecosystem Rewards (50%)" value="500,000,000 EAST" />
          <Row label="Liquidity Pool (15%)" value="150,000,000 EAST" />
          <Row label="Treasury (10%)" value="100,000,000 EAST" />
          <Row label="Emergency Reserve (7%)" value="70,000,000 EAST" />
          <Row label="Marketing & Growth (7%)" value="70,000,000 EAST" />
          <Row label="Team & Development (6%)" value="60,000,000 EAST" />
          <Row label="Founder Allocation (5%)" value="50,000,000 EAST" />
        </div>
      </Section>

      <Section title="3. Ecosystem Rewards (50%)">
        <p>500,000,000 EAST dedicated exclusively to long-term ecosystem incentives.</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Proof of Contribution (PoC) Mining</p>
          <p className="text-white/70 text-sm">→ Validator Rewards</p>
          <p className="text-white/70 text-sm">→ Light Node Rewards</p>
          <p className="text-white/70 text-sm">→ Staking Rewards</p>
          <p className="text-white/70 text-sm">→ Referral Program</p>
          <p className="text-white/70 text-sm">→ Future Community Incentives</p>
        </div>
        <p className="mt-2">Not unlocked at genesis. Rewards are distributed through a predefined on-chain emission schedule — tokens enter circulation only when earned by participants.</p>
      </Section>

      <Section title="4. Liquidity Pool (15%)">
        <p>150,000,000 EAST reserved for maintaining healthy market liquidity.</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Initial DEX Liquidity</p>
          <p className="text-white/70 text-sm">→ Centralized Exchange Liquidity</p>
          <p className="text-white/70 text-sm">→ Cross-chain Bridge Liquidity</p>
          <p className="text-white/70 text-sm">→ Future Liquidity Expansion</p>
        </div>
        <p className="text-white font-bold mt-2 mb-1">Suggested Internal Allocation</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Initial DEX Liquidity" value="40%" />
          <Row label="CEX Market Making" value="30%" />
          <Row label="Cross-chain Liquidity" value="20%" />
          <Row label="Future Liquidity Reserve" value="10%" />
        </div>
      </Section>

      <Section title="5. Treasury (10%)">
        <p>100,000,000 EAST — the primary operational fund of EastChain. All fundraising activities originate from this allocation.</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <Row label="Strategic Round" value="10,000,000 EAST" />
          <Row label="Private Sale" value="15,000,000 EAST" />
          <Row label="Public Sale" value="5,000,000 EAST" />
          <Row label="Ecosystem Grants" value="20,000,000 EAST" />
          <Row label="Infrastructure & Security" value="15,000,000 EAST" />
          <Row label="Listings & Market Making" value="20,000,000 EAST" />
          <Row label="Treasury Reserve" value="15,000,000 EAST" />
        </div>
        <p className="mt-2">No tokens for fundraising will ever be taken from Founder Allocation.</p>
      </Section>

      <Section title="6. Emergency Reserve (7%)">
        <p>70,000,000 EAST reserved for exceptional situations:</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Critical Security Incidents</p>
          <p className="text-white/70 text-sm">→ Emergency Chain Recovery</p>
          <p className="text-white/70 text-sm">→ Major Infrastructure Failures</p>
          <p className="text-white/70 text-sm">→ Governance-approved Strategic Needs</p>
        </div>
        <p className="mt-2">Reserve funds remain locked unless approved through governance.</p>
      </Section>

      <Section title="7. Marketing & Growth (7%)">
        <p>70,000,000 EAST used to accelerate ecosystem adoption:</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Global Marketing Campaigns</p>
          <p className="text-white/70 text-sm">→ Trading Competitions</p>
          <p className="text-white/70 text-sm">→ Community Incentives</p>
          <p className="text-white/70 text-sm">→ Ambassador Program</p>
          <p className="text-white/70 text-sm">→ Conferences</p>
          <p className="text-white/70 text-sm">→ Developer Programs</p>
          <p className="text-white/70 text-sm">→ Partnership Campaigns</p>
        </div>
      </Section>

      <Section title="8. Team & Development (6%)">
        <p>60,000,000 EAST allocated to developers, engineers, designers, researchers, and future contributors.</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Core Development</p>
          <p className="text-white/70 text-sm">→ Wallet Development</p>
          <p className="text-white/70 text-sm">→ Infrastructure</p>
          <p className="text-white/70 text-sm">→ Security Research</p>
          <p className="text-white/70 text-sm">→ Maintenance</p>
        </div>
      </Section>

      <Section title="9. Founder Allocation (5%)">
        <p>50,000,000 EAST representing long-term commitment to EastChain. Founder tokens are not used for fundraising and cannot be sold before vesting begins.</p>
      </Section>

      <Section title="10. Vesting Schedule">
        <p className="text-white font-bold mb-1">Founder Allocation — 50,000,000 EAST</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Cliff" value="12 Months" />
          <Row label="Vesting" value="48 Months" />
          <Row label="Unlock Method" value="Linear Monthly" />
        </div>
        <p className="text-white/50 text-[10px] uppercase mt-1">No tokens are unlocked during the first year.</p>

        <div className="my-2 border-t border-white/5" />
        <p className="text-white font-bold mb-1">Team Allocation — 60,000,000 EAST</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Cliff" value="6 Months" />
          <Row label="Vesting" value="36 Months" />
          <Row label="Unlock Method" value="Linear Monthly" />
        </div>

        <div className="my-2 border-t border-white/5" />
        <p className="text-white font-bold mb-1">Marketing Allocation</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Initial Unlock" value="10%" />
          <Row label="Remaining Unlock" value="90% over 36 months" />
        </div>

        <div className="my-2 border-t border-white/5" />
        <p><span className="text-white font-bold">Treasury</span> — governed by multi-signature governance; funds released only per approved operational requirements.</p>
        <p><span className="text-white font-bold">Emergency Reserve</span> — locked indefinitely; only governance approval can authorize emergency spending.</p>
        <p><span className="text-white font-bold">Liquidity</span> — unlocked according to listing requirements; unused liquidity remains locked.</p>
        <p><span className="text-white font-bold">Ecosystem Rewards</span> — follows a controlled on-chain emission schedule; no immediate unlock at genesis, released only when earned through network participation.</p>
      </Section>

      <Section title="11. Fundraising Policy">
        <p>EastChain fundraising follows a treasury-first approach. Funding rounds include:</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Strategic Round</p>
          <p className="text-white/70 text-sm">→ Private Sale</p>
          <p className="text-white/70 text-sm">→ Public Sale</p>
        </div>
        <p className="mt-2">All sale allocations originate exclusively from the Treasury Allocation. Founder tokens will never be sold for fundraising.</p>
      </Section>

      <Section title="12. Transaction Fee Policy">
        <p>Every transaction on EastChain pays a network gas fee, distributed as follows:</p>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5 mt-2">
          <p className="text-white/70 text-sm">→ Validator Rewards</p>
          <p className="text-white/70 text-sm">→ Network Maintenance</p>
          <p className="text-white/70 text-sm">→ Partial Burn (optional, governance controlled)</p>
          <p className="text-white/70 text-sm">→ Emergency Reserve Contribution</p>
        </div>
        <p className="mt-2">A governance-defined percentage of all collected gas fees is periodically transferred into the Emergency Reserve, creating a self-sustaining reserve fund capable of supporting EastChain during unforeseen events without requiring additional token issuance.</p>
      </Section>

      <Section title="13. Economic Principles">
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-1.5">
          <p className="text-white/70 text-sm">→ Fixed Maximum Supply</p>
          <p className="text-white/70 text-sm">→ No Hidden Token Minting</p>
          <p className="text-white/70 text-sm">→ Treasury-funded Development</p>
          <p className="text-white/70 text-sm">→ Founder Tokens Never Used for Fundraising</p>
          <p className="text-white/70 text-sm">→ Long-term Vesting for Core Contributors</p>
          <p className="text-white/70 text-sm">→ Sustainable Ecosystem Incentives</p>
          <p className="text-white/70 text-sm">→ Transparent Treasury Management</p>
          <p className="text-white/70 text-sm">→ Governance-controlled Reserve</p>
          <p className="text-white/70 text-sm">→ Network Security through PoC Incentives</p>
          <p className="text-white/70 text-sm">→ Long-term Economic Sustainability</p>
        </div>
      </Section>

      <div className="text-center py-4 border-t border-white/5">
        <p className="text-primary font-bold text-xs uppercase tracking-widest">EASTCHAIN Protocol</p>
        <p className="text-white/30 text-[10px] mt-1">Fixed Supply · Treasury-First · Transparent Allocation</p>
      </div>
    </div>
  );
}

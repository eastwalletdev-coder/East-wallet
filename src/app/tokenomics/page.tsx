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

function Bullet({ children }: { children: React.ReactNode }) {
  return <p className="text-white/70 text-sm">→ {children}</p>;
}


/** Donut chart for fixed supply allocation — pure SVG, no chart library. */
function AllocationDiagram() {
  const slices = [
    { label: "Ecosystem Rewards", pct: 50, color: "#8B5CF6" },
    { label: "Liquidity Pool", pct: 15, color: "#6366F1" },
    { label: "Treasury", pct: 10, color: "#3B82F6" },
    { label: "Emergency Reserve", pct: 7, color: "#06B6D4" },
    { label: "Marketing & Growth", pct: 7, color: "#14B8A6" },
    { label: "Team & Development", pct: 6, color: "#A78BFA" },
    { label: "Founder Allocation", pct: 5, color: "#C4B5FD" },
  ];
  const r = 42;
  const c = 50;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = (s.pct / 100) * circ;
    const dash = `${len} ${circ - len}`;
    const el = { ...s, dash, offset: -offset };
    offset += len;
    return el;
  });
  return (
    <Card className="bg-white/[0.03] border-white/5 rounded-2xl overflow-hidden">
      <CardContent className="p-4">
        <p className="text-primary font-bold text-sm uppercase tracking-wider mb-3">
          Allocation Overview
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-[180px] h-[180px] shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
              {arcs.map((a) => (
                <circle
                  key={a.label}
                  cx={c}
                  cy={c}
                  r={r}
                  fill="none"
                  stroke={a.color}
                  strokeWidth="12"
                  strokeDasharray={a.dash}
                  strokeDashoffset={a.offset}
                  strokeLinecap="butt"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-white font-black text-lg leading-none">1B</span>
              <span className="text-white/40 text-[9px] uppercase tracking-wider mt-0.5">EAST</span>
            </div>
          </div>
          <div className="flex-1 w-full space-y-1.5">
            {slices.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                <span className="text-white/70 flex-1 truncate">{s.label}</span>
                <span className="text-white font-bold tabular-nums">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-white/35 text-[10px] mt-3 leading-relaxed">
          Fixed maximum supply · allocations enforced via on-chain supply buckets
        </p>
      </CardContent>
    </Card>
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
          <p className="text-white/40 text-[10px] uppercase tracking-wider">Supply, Allocation & Vesting</p>
        </div>
      </header>

      {/* Overview */}
      <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
        <CardContent className="p-4 space-y-2">
          <p className="text-primary font-bold text-base mb-1">Fixed Maximum Supply</p>
          <p className="text-white text-2xl font-black">1,000,000,000 EAST</p>
          <p className="text-white/60 text-xs leading-relaxed">
            No additional tokens will ever be minted beyond the maximum supply. Every allocation
            below is enforced on-chain via supply bucket caps — see the Whitepaper's Anchor Protocol section.
          </p>
          <div className="pt-2 space-y-1.5">
            <Row label="Ticker" value="EAST" />
            <Row label="Blockchain" value="EastChain Mainnet" />
            <Row label="Consensus" value="PoC / PoS / PoA / PoR" />
          </div>
        </CardContent>
      </Card>

      <AllocationDiagram />

            <Section title="1. Token Allocation" defaultOpen>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <Row label="Ecosystem Rewards" value="50% · 500,000,000" />
          <Row label="Liquidity Pool" value="15% · 150,000,000" />
          <Row label="Treasury" value="10% · 100,000,000" />
          <Row label="Emergency Reserve" value="7% · 70,000,000" />
          <Row label="Marketing & Growth" value="7% · 70,000,000" />
          <Row label="Team & Development" value="6% · 60,000,000" />
          <Row label="Founder Allocation" value="5% · 50,000,000" />
        </div>
      </Section>

      <Section title="2. Ecosystem Rewards (50%)">
        <p className="text-white font-bold">500,000,000 EAST</p>
        <p>Dedicated exclusively to long-term ecosystem incentives:</p>
        <Bullet>Proof of Contribution (PoC) Mining</Bullet>
        <Bullet>Validator Rewards</Bullet>
        <Bullet>Light Node Rewards</Bullet>
        <Bullet>Staking Rewards</Bullet>
        <Bullet>Referral Program</Bullet>
        <Bullet>Future Community Incentives</Bullet>
        <p className="pt-1">
          Not unlocked at genesis — distributed only through a predefined on-chain emission
          schedule. Tokens enter circulation only when earned by participants.
        </p>
      </Section>

      <Section title="3. Liquidity Pool (15%)">
        <p className="text-white font-bold">150,000,000 EAST</p>
        <p>Reserved for maintaining healthy market liquidity:</p>
        <Bullet>Initial DEX Liquidity</Bullet>
        <Bullet>Centralized Exchange Liquidity</Bullet>
        <Bullet>Cross-chain Bridge Liquidity</Bullet>
        <Bullet>Future Liquidity Expansion</Bullet>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Suggested Internal Split</p>
          <Row label="Initial DEX Liquidity" value="40%" />
          <Row label="CEX Market Making" value="30%" />
          <Row label="Cross-chain Liquidity" value="20%" />
          <Row label="Future Liquidity Reserve" value="10%" />
        </div>
      </Section>

      <Section title="4. Treasury (10%)">
        <p className="text-white font-bold">100,000,000 EAST</p>
        <p>The primary operational fund of EastChain. All fundraising activities originate from this allocation:</p>
        <Bullet>Private / Strategic / Public Sale</Bullet>
        <Bullet>Exchange Listings & Market Making</Bullet>
        <Bullet>Infrastructure & Security Audits</Bullet>
        <Bullet>Legal Compliance</Bullet>
        <Bullet>Ecosystem Grants & Partnerships</Bullet>
        <Bullet>Core Operations</Bullet>
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Suggested Treasury Distribution</p>
          <Row label="Strategic Round" value="10,000,000" />
          <Row label="Private Sale" value="15,000,000" />
          <Row label="Public Sale" value="5,000,000" />
          <Row label="Ecosystem Grants" value="20,000,000" />
          <Row label="Infrastructure & Security" value="15,000,000" />
          <Row label="Listings & Market Making" value="20,000,000" />
          <Row label="Treasury Reserve" value="15,000,000" />
        </div>
        <p className="pt-1 text-white font-bold">No tokens for fundraising will ever be taken from Founder Allocation.</p>
      </Section>

      <Section title="5. Emergency Reserve (7%)">
        <p className="text-white font-bold">70,000,000 EAST</p>
        <p>Reserved for exceptional situations:</p>
        <Bullet>Critical Security Incidents</Bullet>
        <Bullet>Emergency Chain Recovery</Bullet>
        <Bullet>Major Infrastructure Failures</Bullet>
        <Bullet>Governance-approved Strategic Needs</Bullet>
        <p className="pt-1">Locked indefinitely — only governance approval can authorize emergency spending.</p>
      </Section>

      <Section title="6. Marketing & Growth (7%)">
        <p className="text-white font-bold">70,000,000 EAST</p>
        <p>Used to accelerate ecosystem adoption:</p>
        <Bullet>Global Marketing Campaigns</Bullet>
        <Bullet>Trading Competitions</Bullet>
        <Bullet>Community Incentives</Bullet>
        <Bullet>Ambassador Program</Bullet>
        <Bullet>Conferences & Developer Programs</Bullet>
        <Bullet>Partnership Campaigns</Bullet>
      </Section>

      <Section title="7. Team & Development (6%)">
        <p className="text-white font-bold">60,000,000 EAST</p>
        <p>Allocated to developers, engineers, designers, researchers, and future contributors:</p>
        <Bullet>Core Development</Bullet>
        <Bullet>Wallet Development</Bullet>
        <Bullet>Infrastructure</Bullet>
        <Bullet>Security Research</Bullet>
        <Bullet>Maintenance</Bullet>
      </Section>

      <Section title="8. Founder Allocation (5%)">
        <p className="text-white font-bold">50,000,000 EAST</p>
        <p>Represents long-term commitment to EastChain.</p>
        <p className="text-white font-bold">Founder tokens are never used for fundraising and cannot be sold before vesting begins.</p>
      </Section>

      <Section title="9. Vesting Schedule">
        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Founder Allocation — 50,000,000 EAST</p>
          <Row label="Cliff" value="12 months" />
          <Row label="Vesting" value="48 months" />
          <Row label="Unlock Method" value="Linear Monthly" />
        </div>
        <p className="text-white/60 text-xs">No tokens unlock during the first year.</p>

        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Team Allocation — 60,000,000 EAST</p>
          <Row label="Cliff" value="6 months" />
          <Row label="Vesting" value="36 months" />
          <Row label="Unlock Method" value="Linear Monthly" />
        </div>

        <div className="bg-white/[0.04] rounded-xl p-3 space-y-2 mt-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Marketing Allocation</p>
          <Row label="Initial Unlock" value="10%" />
          <Row label="Remaining 90%" value="Gradual over 36 months" />
        </div>

        <div className="space-y-1.5 mt-2">
          <Bullet>Treasury — governed by multi-signature governance, released only per approved operational requirements.</Bullet>
          <Bullet>Emergency Reserve — locked indefinitely, governance approval only.</Bullet>
          <Bullet>Liquidity — unlocked according to listing requirements; unused liquidity stays locked.</Bullet>
          <Bullet>Ecosystem Rewards — controlled on-chain emission, no unlock at genesis, released only when earned.</Bullet>
        </div>
      </Section>

      <Section title="10. Fundraising Policy">
        <p>EastChain fundraising follows a treasury-first approach. Funding rounds include:</p>
        <Bullet>Strategic Round</Bullet>
        <Bullet>Private Sale</Bullet>
        <Bullet>Public Sale</Bullet>
        <p className="pt-1 text-white font-bold">
          All sale allocations originate exclusively from the Treasury Allocation. Founder tokens will never be sold for fundraising.
        </p>
      </Section>

      <Section title="11. Transaction Fee Policy">
        <p>Every transaction on EastChain pays a network gas fee, distributed as:</p>
        <Bullet>Validator Rewards</Bullet>
        <Bullet>Network Maintenance</Bullet>
        <Bullet>Partial Burn (optional, governance controlled)</Bullet>
        <Bullet>Emergency Reserve Contribution</Bullet>
        <p className="pt-1">
          A governance-defined percentage of all collected gas fees is periodically transferred
          into the Emergency Reserve — a self-sustaining fund that supports EastChain during
          unforeseen events without requiring additional token issuance.
        </p>
      </Section>

      <Section title="12. Economic Principles">
        <Bullet>Fixed Maximum Supply</Bullet>
        <Bullet>No Hidden Token Minting</Bullet>
        <Bullet>Treasury-funded Development</Bullet>
        <Bullet>Founder Tokens Never Used for Fundraising</Bullet>
        <Bullet>Long-term Vesting for Core Contributors</Bullet>
        <Bullet>Sustainable Ecosystem Incentives</Bullet>
        <Bullet>Transparent Treasury Management</Bullet>
        <Bullet>Governance-controlled Reserve</Bullet>
        <Bullet>Network Security through PoC Incentives</Bullet>
        <Bullet>Long-term Economic Sustainability</Bullet>
      </Section>

    </div>
  );
}

"use client"

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/5 overflow-hidden bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/5"
      >
        <span className="text-primary font-bold text-sm tracking-wide uppercase text-left">
          {title}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-primary/60 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-primary/60 shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 text-white text-sm leading-relaxed space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <p className="text-white/75 text-sm pl-1">→ {children}</p>;
}

export default function WhitepaperPage() {
  return (
    <div className="flex flex-col gap-4 px-3 py-4 pb-8">
      <header className="flex items-center gap-3">
        <Link href="/profile">
          <Button variant="ghost" size="icon" className="text-white">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-primary font-extrabold uppercase tracking-widest text-base">
            EAST Whitepaper
          </h1>
          <p className="text-white/40 text-[10px] uppercase tracking-wider">
            One Smartphone · One Node · One Future
          </p>
        </div>
      </header>

      <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
        <CardContent className="p-4 space-y-2">
          <p className="text-primary font-bold text-base">One Smartphone, One Node, One Future</p>
          <p className="text-white/80 text-sm leading-relaxed">
            EAST is a next-generation decentralized infrastructure designed to make blockchain
            technology secure, transparent, and accessible to everyone.
          </p>
          <p className="text-white/70 text-sm leading-relaxed">
            Rather than focusing solely on building another Layer 1 blockchain, EAST is developing
            multiple foundational technologies simultaneously to redefine how decentralized networks
            operate.
          </p>
        </CardContent>
      </Card>

      <Section title="Introduction" defaultOpen>
        <p>The EAST ecosystem combines:</p>
        <Bullet>A high-performance EVM-compatible Layer 1 blockchain</Bullet>
        <Bullet>Browser-based Full Nodes</Bullet>
        <Bullet>Browser-based Light Nodes</Bullet>
        <Bullet>Mobile validator infrastructure</Bullet>
        <Bullet>Distributed data propagation</Bullet>
        <Bullet>Community-powered network security</Bullet>
        <p className="pt-1 text-white/90 font-medium">
          Every smartphone can become part of the blockchain network — not merely as a wallet, but
          as an active participant helping secure, validate, and distribute blockchain data across
          the world.
        </p>
      </Section>

      <Section title="The EAST Vision">
        <p>
          Traditional blockchains rely heavily on validator servers and specialized infrastructure.
          EAST introduces a different approach.
        </p>
        <p>
          By leveraging modern browser technologies and peer-to-peer networking, millions of everyday
          devices can participate in maintaining blockchain data without requiring expensive hardware
          or complex setup.
        </p>
        <p className="text-primary/90 font-medium">
          Long-term mission: build one of the world&apos;s largest decentralized mobile infrastructures.
        </p>
      </Section>

      <Section title="EAST Ecosystem">
        <p>Integrated components of a unified decentralized ecosystem:</p>
        <Bullet>EAST Wallet</Bullet>
        <Bullet>EAST Ledger</Bullet>
        <Bullet>EAST PASS</Bullet>
        <Bullet>Mobile Mining</Bullet>
        <Bullet>Staking System</Bullet>
        <Bullet>Mobile Validator Network</Bullet>
        <Bullet>Browser Full Node Network</Bullet>
        <Bullet>Browser Light Node Network</Bullet>
        <Bullet>EAST Explorer</Bullet>
        <Bullet>EAST Treasury</Bullet>
      </Section>

      <Section title="Current Technology Foundation">
        <p>The first generation of EAST is built upon:</p>
        <Bullet>Serverless cloud infrastructure</Bullet>
        <Bullet>Secure ledger architecture</Bullet>
        <Bullet>Encrypted transaction records</Bullet>
        <Bullet>RSA 4096 identity security</Bullet>
        <Bullet>Scalable backend services</Bullet>
        <Bullet>Public transaction explorer</Bullet>
        <Bullet>Mobile-first ecosystem architecture</Bullet>
        <p className="pt-1 text-white/60 text-xs">
          This infrastructure is the foundation for the next stage of EAST&apos;s decentralization roadmap.
        </p>
      </Section>

      <Section title="Beyond Layer 1">
        <p>
          EAST is not only building an EVM-compatible Layer 1. A primary objective is solving a more
          ambitious challenge: <span className="text-white font-semibold">running blockchain
          infrastructure directly inside web browsers</span>.
        </p>
        <p>
          The team is actively researching technologies that allow browsers to store, validate, and
          distribute blockchain data — lowering the barrier to participation while improving
          decentralization.
        </p>
      </Section>

      <Section title="Browser Full Node Network">
        <p>
          Unlike traditional full nodes on dedicated servers, EAST Browser Full Nodes are designed
          to operate inside modern web browsers.
        </p>
        <p className="text-white/50 text-[10px] uppercase font-bold tracking-wider">Responsibilities</p>
        <Bullet>Maintaining blockchain history</Bullet>
        <Bullet>Verifying every received block independently</Bullet>
        <Bullet>Verifying transaction integrity</Bullet>
        <Bullet>Storing blockchain data locally</Bullet>
        <Bullet>Redistributing validated blocks via peer-to-peer networking</Bullet>
        <Bullet>Increasing network redundancy</Bullet>
        <Bullet>Helping preserve history across geographically distributed devices</Bullet>
      </Section>

      <Section title="Browser Light Node Network">
        <p>
          Light Nodes are optimized for lightweight devices while still participating in blockchain
          verification — active contributors, not passive clients.
        </p>
        <p className="text-white/50 text-[10px] uppercase font-bold tracking-wider">Responsibilities</p>
        <Bullet>Independently verifying block headers</Bullet>
        <Bullet>Validating cryptographic proofs</Bullet>
        <Bullet>Confirming received blockchain data</Bullet>
        <Bullet>Broadcasting validated data to neighboring peers</Bullet>
        <Bullet>Participating in peer discovery</Bullet>
        <Bullet>Strengthening network availability</Bullet>
      </Section>

      <Section title="Global Peer-to-Peer Data Network">
        <p>
          Full and Light Node networks communicate peer-to-peer. Blockchain data can propagate
          between devices worldwide instead of relying solely on validator servers.
        </p>
        <Bullet>Geographic data distribution</Bullet>
        <Bullet>Reduced reliance on centralized infrastructure</Bullet>
        <Bullet>Faster decentralized propagation</Bullet>
        <Bullet>Increased censorship resistance</Bullet>
        <Bullet>Greater network redundancy</Bullet>
        <Bullet>Independent verification by participating devices</Bullet>
      </Section>

      <Section title="Mobile Validator Network">
        <p className="text-primary font-semibold">Every Smartphone Can Become a Node.</p>
        <p>
          EAST continues developing mobile validator infrastructure where smartphones may help
          secure the blockchain.
        </p>
        <Bullet>Transaction verification</Bullet>
        <Bullet>Block validation</Bullet>
        <Bullet>Consensus participation</Bullet>
        <Bullet>Network availability</Bullet>
        <Bullet>Security contribution</Bullet>
        <p className="text-white/60 text-xs pt-1">
          Validators remain essential while Browser Full and Light Nodes add decentralized
          verification and data distribution.
        </p>
      </Section>

      <Section title="EAST Consensus Model">
        <p>
          EAST plans a hybrid consensus architecture combining multiple mechanisms for
          decentralization, efficiency, and reliability.
        </p>
        <p className="text-white font-bold">Proof of Stake (PoS)</p>
        <p className="text-white/70">Participants secure the network through staking.</p>
        <p className="text-white font-bold">Proof of Reputation (PoR)</p>
        <p className="text-white/70">
          Validator trust is evaluated through long-term reliability, historical performance, and
          contribution.
        </p>
        <p className="text-white font-bold">Proof of Availability (PoA)</p>
        <p className="text-white/70">
          Nodes that consistently remain online and responsive earn greater reputation.
        </p>
        <p className="text-white/50 text-[10px] uppercase font-bold tracking-wider pt-1">
          Evaluation factors
        </p>
        <Bullet>Stake amount</Bullet>
        <Bullet>Device uptime</Bullet>
        <Bullet>Connection stability</Bullet>
        <Bullet>Network latency</Bullet>
        <Bullet>Historical reliability</Bullet>
        <Bullet>Community contribution</Bullet>
      </Section>

      <Section title="Incentivized Network Participation">
        <p>Decentralization should reward meaningful participation.</p>
        <p>Future incentives are planned for operators of:</p>
        <Bullet>Browser Full Nodes</Bullet>
        <Bullet>Browser Light Nodes</Bullet>
        <Bullet>Mobile Validators</Bullet>
        <p className="text-white/60 text-xs">
          Specific incentive mechanisms will evolve as the protocol matures.
        </p>
      </Section>

      <Section title="EAST PASS Ecosystem">
        <p>EAST PASS is a premium gateway into the ecosystem. Benefits may include:</p>
        <Bullet>Enhanced mining acceleration</Bullet>
        <Bullet>Staking benefits</Bullet>
        <Bullet>Validator ecosystem participation</Bullet>
        <Bullet>Early access to ecosystem features</Bullet>
        <Bullet>Priority access to future innovations</Bullet>
        <p className="text-white/60 text-xs">
          Founder EAST PASS holders represent the earliest supporters of the long-term vision.
        </p>
      </Section>

      <Section title="Development Roadmap">
        <p className="text-white font-bold">Phase 1 — Foundation</p>
        <Bullet>EAST Wallet · Secure Ledger · Mining · Staking · EAST PASS · Explorer · Backend</Bullet>
        <p className="text-white font-bold pt-1">Phase 2 — Hybrid Blockchain</p>
        <Bullet>EVM-Compatible L1 · Explorer · Block Validation · Validator Network · Hybrid Consensus</Bullet>
        <p className="text-white font-bold pt-1">Phase 3 — Browser Network</p>
        <Bullet>Browser Light/Full Node prototypes · Global P2P · Distributed storage · Independent validation</Bullet>
        <p className="text-white font-bold pt-1">Phase 4 — Decentralized Infrastructure</p>
        <Bullet>Worldwide browser nodes · Community governance · EAST DAO · Large-scale mobile infrastructure</Bullet>
      </Section>

      <Section title="Prototype Community">
        <p>
          The first prototype of EAST Browser Node technology is introduced through Telegram Mini
          Apps so the global community can run experimental browser nodes from smartphones.
        </p>
        <Bullet>Test new technologies</Bullet>
        <Bullet>Operate Browser Nodes</Bullet>
        <Bullet>Evaluate network performance</Bullet>
        <Bullet>Share feedback and real-world experience</Bullet>
        <Bullet>Help improve protocol design</Bullet>
        <p className="text-white/70 text-sm pt-1">
          The EAST community is an active partner in shaping decentralized infrastructure.
        </p>
      </Section>

      <Section title="Decentralized Future">
        <p>
          EAST envisions blockchain infrastructure no longer limited to specialized servers. Millions
          of everyday devices will collectively maintain, verify, and distribute data through
          decentralized peer-to-peer networking.
        </p>
        <p className="text-primary font-bold text-center pt-2">
          One Smartphone. One Node. One Future.
        </p>
      </Section>
    </div>
  );
}

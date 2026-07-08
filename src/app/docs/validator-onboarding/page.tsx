'use client';

import { useState } from 'react';
import { ChevronDown, Check, AlertCircle } from 'lucide-react';

export default function ValidatorOnboardingPage() {
  const [expandedStep, setExpandedStep] = useState(0);

  const steps = [
    {
      number: 1,
      title: 'Understand Requirements',
      content: `
Before starting, make sure you understand:

• **Stake Requirement:** You must have at least 1000 EAST staked in the system to be eligible for validator selection
• **Uptime Requirement:** Your validator node must stay online and send heartbeats every 30 seconds (buffer: 90 seconds before considered offline)
• **Self-Custody:** Your private key is generated and stored locally on your server — never sent to the server
• **Hardware:** A VPS or always-on server with stable internet (recommended: ≥1GB RAM, ≥2GB disk, reliable 5Mbps+ connection)
• **Cost:** Heartbeat is cheap (minimal gas), but you pay electricity/hosting costs
• **Slashing Risk:** Not implemented yet, but planned — offline validators may have stake reduced in future versions
      `.trim(),
    },
    {
      number: 2,
      title: 'Fund Your Wallet & Stake EAST',
      content: `
1. Open EastChain Mini App in Telegram
2. Get EAST tokens (ask the team for testnet tokens)
3. Go to wallet/staking section
4. Stake at least 1000 EAST (the more you stake, the higher your validator score)
5. Wait for the next epoch (daily, usually midnight UTC) to be included in PoC scoring

Check: /api/consensus/status — "Active External Validators" count should be visible
      `.trim(),
    },
    {
      number: 3,
      title: 'Generate Self-Custody Key on Server',
      content: `
On the server where your validator node will run:

\`\`\`bash
# Clone the repo or copy scripts/apply-validator-cli.js
node scripts/apply-validator-cli.js

# Interactive prompts:
# - EastChain API URL: https://your-app.vercel.app
# - Telegram ID: your numeric Telegram ID
# - Generate new mnemonic or import existing

# Output: .eastchain-validator-vault.json (encrypted locally)
\`\`\`

**Important:** Back up the mnemonic phrase securely (not the vault file — the 24-word phrase). If you lose both, your validator identity cannot be recovered.
      `.trim(),
    },
    {
      number: 4,
      title: 'Register Self-Custody & Apply for Candidacy',
      content: `
The \`apply-validator-cli.js\` script does this automatically:

1. Registers your public key as "self-custody" (proves you hold the private key)
2. Applies for validator candidacy (status: pending_review)

Check status:
\`\`\`bash
curl https://your-app.vercel.app/api/admin/validator-candidates \\
  -H "x-cron-secret: <ADMIN_SECRET>"
\`\`\`

You should see your \`telegram_id\` with status \`pending_review\`.
      `.trim(),
    },
    {
      number: 5,
      title: 'Wait for Admin Approval',
      content: `
An admin will review your candidacy and approve or reject. Approval does NOT mean you're an active validator yet — only that you're whitelisted.

You become "active" when:
1. Status = "approved" in validator_candidates
2. You're in top-N by PoC score in the current epoch
3. Your heartbeat is fresh (within 90 seconds)

Check: visit /admin/validator-review or wait for email confirmation.
      `.trim(),
    },
    {
      number: 6,
      title: 'Start Heartbeat Daemon',
      content: `
Once approved and in top-N, start the heartbeat daemon on your server:

\`\`\`bash
EASTCHAIN_API_URL=https://your-app.vercel.app \\
EASTCHAIN_TELEGRAM_ID=your-numeric-id \\
EASTCHAIN_VAULT_PATH=/path/to/.eastchain-validator-vault.json \\
node scripts/heartbeat-daemon.js
\`\`\`

The daemon will:
• Prompt for vault password (once at startup)
• Send heartbeat every 30 seconds
• Log success/errors to console
• Keep your node marked as "active" in the network

**Recommended:** Run via systemd or supervisor so it auto-restarts on crash.
      `.trim(),
    },
    {
      number: 7,
      title: 'Monitor Your Status',
      content: `
Visit /consensus/status to see:
• Current consensus mode (internal vs leader-proposal)
• How many external validators are online
• Your telegram_id in the active list (once heartbeating)

Visit /api/consensus/status for JSON API:
\`\`\`bash
curl https://your-app.vercel.app/api/consensus/status
\`\`\`

Troubleshooting:
• If heartbeat fails with 403 "NOT_AN_ACTIVE_VALIDATOR": wait for next epoch, or check stake is ≥1000
• If heartbeat fails with "SELF_CUSTODY_REQUIRED": re-run apply-validator-cli.js
• If daemon crashes: check logs, redeploy, or contact team
      `.trim(),
    },
    {
      number: 8,
      title: 'Get Block Execution Rights (Future)',
      content: `
Once ≥2 external validators are online, "leader-proposal mode" activates:

• Vercel will start deterministically electing one validator per block
• That validator gets a short window (~15 seconds) to counter-sign the proposal
• Your node must be ready to sign when elected — the daemon will support this in v2

For now, you just heartbeat and wait for future updates.
      `.trim(),
    },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Become an EastChain Validator</h1>
        <p className="text-gray-600 mt-2">
          Step-by-step guide to run a validator node and participate in EastChain consensus.
        </p>
      </div>

      {/* Prerequisites Alert */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-amber-900">Prerequisites</p>
          <p className="text-amber-800 mt-1">
            You must have ≥1000 EAST staked. You need a VPS or always-on server. You will need an ADMIN_SECRET for some endpoints (ask the team).
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="border rounded-lg">
            <button
              onClick={() => setExpandedStep(expandedStep === i ? -1 : i)}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">
                  {step.number}
                </div>
                <h3 className="font-semibold text-left">{step.title}</h3>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-400 transition-transform ${
                  expandedStep === i ? 'rotate-180' : ''
                }`}
              />
            </button>

            {expandedStep === i && (
              <div className="px-4 pb-4 pt-0 border-t bg-gray-50">
                <div className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{step.content}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="border rounded-lg p-6 bg-blue-50">
        <h3 className="font-bold mb-4 flex items-center gap-2">
          <Check className="w-5 h-5 text-blue-600" />
          Timeline & What to Expect
        </h3>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-semibold">Day 1:</span> Stake 1000+ EAST, run CLI, get approved
          </p>
          <p>
            <span className="font-semibold">Day 2:</span> Next epoch runs (daily), your PoC score calculated, (hopefully) elected to top-N
          </p>
          <p>
            <span className="font-semibold">Ongoing:</span> Run daemon, heartbeat every 30s, monitor status
          </p>
          <p>
            <span className="font-semibold">Future:</span> Once ≥2 external validators online, get block proposal rights
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div className="border rounded-lg p-6">
        <h3 className="font-bold mb-4">Frequently Asked Questions</h3>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold">Q: What's my validator score?</p>
            <p className="text-gray-700 mt-1">Score = (Stake × 0.4) + (Uptime × 0.35) + (Reputation × 0.25). Top N scores get elected each epoch.</p>
          </div>
          <div>
            <p className="font-semibold">Q: Can I lose my stake?</p>
            <p className="text-gray-700 mt-1">Slashing is planned but not implemented yet. For now, stake is only locked (can't spend it), not at risk.</p>
          </div>
          <div>
            <p className="font-semibold">Q: What if my node goes offline?</p>
            <p className="text-gray-700 mt-1">You stop sending heartbeats → marked as offline after 90s → no longer in "active external" count → lose leader-proposal eligibility. If you come back online, heartbeat resumes.</p>
          </div>
          <div>
            <p className="font-semibold">Q: Where's my private key?</p>
            <p className="text-gray-700 mt-1">Local file: .eastchain-validator-vault.json (AES-256-GCM encrypted). Server never sees it. If you lose both the file and your mnemonic backup, there's no recovery.</p>
          </div>
          <div>
            <p className="font-semibold">Q: How do I contact the team?</p>
            <p className="text-gray-700 mt-1">Telegram group or GitHub issues. Include your validator telegram_id when asking for help.</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t pt-6 text-xs text-gray-600">
        <p>
          This guide is for EastChain testnet. Mainnet rules will be more strict. Always keep your mnemonic phrase secure and offline.
        </p>
      </div>
    </div>
  );
}

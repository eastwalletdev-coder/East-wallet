'use client';

import { useState } from 'react';
import { useTelegram } from '@/hooks/use-telegram';
import { Button } from '@/components/ui/button';
import { Copy, Check, AlertTriangle } from 'lucide-react';

// Real Telegram initData is signed with an auth_date and is checked for
// freshness server-side (~5 minute window — see validateTelegramData()/
// requireVerifiedTelegramId()) — copy it and use it right away.
export default function InitDataDebugPage() {
  const { initData, tgUser, loading } = useTelegram();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!initData) return;
    await navigator.clipboard.writeText(initData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">Debug: Telegram initData</h1>
      <p className="text-sm text-gray-500">
        This is only for local setup purposes (e.g. <code>apply-validator-cli.js</code> via{' '}
        <code>EASTCHAIN_TELEGRAM_INIT_DATA</code>). Must be opened from inside Telegram (Mini App),
        not a regular browser — if empty, this page is likely opened outside Telegram.
      </p>

      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          This string proves your Telegram identity for the next ~5 minutes — don't
          share it with anyone except for your own CLI setup.
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !initData ? (
        <p className="text-sm text-red-500">
          initData is empty — open this page from inside the Telegram Mini App, not a regular browser.
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs text-gray-500 mb-1">Telegram ID</p>
            <p className="font-mono text-sm">{tgUser?.id}</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">initData (expires in ~5 minutes)</p>
            <textarea
              readOnly
              value={initData}
              className="w-full h-32 px-3 py-2 text-xs font-mono border rounded resize-none"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
          </div>

          <Button onClick={handleCopy} className="w-full" size="sm">
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" /> Copy initData
              </>
            )}
          </Button>

          <p className="text-xs text-gray-400">
            Then run (within ~5 minutes):<br />
            <code className="block mt-1 p-2 bg-gray-50 rounded break-all">
              EASTCHAIN_TELEGRAM_INIT_DATA=&quot;...&quot; node scripts/apply-validator-cli.js
            </code>
          </p>
        </>
      )}
    </div>
  );
}

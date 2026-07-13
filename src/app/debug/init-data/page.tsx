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
        Ini cuma untuk keperluan setup lokal (mis. <code>apply-validator-cli.js</code> lewat{' '}
        <code>EASTCHAIN_TELEGRAM_INIT_DATA</code>). Harus dibuka dari dalam Telegram (Mini App),
        bukan browser biasa — kalau kosong, kemungkinan halaman ini dibuka di luar Telegram.
      </p>

      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          String ini membuktikan identitas Telegram kamu untuk ~5 menit ke depan — jangan
          share ke siapa pun selain buat setup CLI kamu sendiri.
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Memuat…</p>
      ) : !initData ? (
        <p className="text-sm text-red-500">
          initData kosong — buka halaman ini dari dalam Telegram Mini App, bukan browser biasa.
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs text-gray-500 mb-1">Telegram ID</p>
            <p className="font-mono text-sm">{tgUser?.id}</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">initData (kadaluarsa ~5 menit)</p>
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
                <Check className="w-4 h-4 mr-2" /> Tersalin!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" /> Copy initData
              </>
            )}
          </Button>

          <p className="text-xs text-gray-400">
            Lalu jalankan (dalam ~5 menit):<br />
            <code className="block mt-1 p-2 bg-gray-50 rounded break-all">
              EASTCHAIN_TELEGRAM_INIT_DATA=&quot;...&quot; node scripts/apply-validator-cli.js
            </code>
          </p>
        </>
      )}
    </div>
  );
}

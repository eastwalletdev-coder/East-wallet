import type { Metadata } from 'next';
import './globals.css';
import { BottomNav } from '@/components/layout/bottom-nav';
import { Toaster } from '@/components/ui/toaster';
import { WalletProvider } from '@/lib/wallet-context';
import { RPCProvider } from '@/lib/rpc-context';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { SplashScreen } from '@/components/SplashScreen';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'EAST Wallet',
  description: 'First Non-custodial Web3 Wallet — Secure With Hybrid Consensus Ledger',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&family=Source+Code+Pro:wght@400;600&display=swap" rel="stylesheet" />
        <script src="https://telegram.org/js/telegram-web-app.js" async></script>
      </head>
      <body className="font-body antialiased bg-background text-foreground overflow-x-hidden pb-20">
        <WalletProvider>
          <RPCProvider>
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, padding: '24px 16px 8px', background: 'rgba(14,12,18,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <Link
                href="/browser"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 36, borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(124,58,237,0.05)' }}
              >
                <Globe style={{ width: 16, height: 16, color: '#7C3AED' }} />
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4em', color: '#fff' }}>Explore Web3 Gateway</span>
              </Link>
            </div>
            <SplashScreen />
            <main style={{ minHeight: '100vh', paddingTop: 80 }}>
              {children}
            </main>
            <BottomNav />
            <Toaster />
          </RPCProvider>
        </WalletProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}

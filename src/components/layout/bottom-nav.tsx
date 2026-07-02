"use client"

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, IdCard, Compass, Wallet, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { label: 'Home',     icon: Home,    href: '/' },
  { label: 'EastPass', icon: IdCard,  href: '/eastpass' },
  { label: 'Explorer', icon: Compass, href: '/explorer' },
  { label: 'Wallet',   icon: Wallet,  href: '/wallet' },
  { label: 'Profile',  icon: User,    href: '/profile' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, background: 'rgba(14,12,18,0.85)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 'env(safe-area-inset-bottom, 8px)', height: 'calc(56px + env(safe-area-inset-bottom, 8px))' }}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href ||
          (item.href === '/explorer' && (pathname === '/swap' || pathname === '/stake'));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className={cn("w-5 h-5", isActive && "fill-primary/20")} />
            <span className="text-[10px] font-medium uppercase tracking-wider">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

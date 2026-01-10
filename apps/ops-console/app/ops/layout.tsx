"use client";
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { opsClient } from '../../src/api/opsClient';

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    opsClient
      .me()
      .then((s: any) => {
        const e = s?.user?.email as string | undefined;
        if (!e) {
          router.replace('/ops/login');
          return;
        }
        setEmail(e);
      })
      .catch(() => router.replace('/ops/login'));
  }, [router]);

  const nav = [
    { label: 'Dashboard', href: '/ops' },
    { label: 'Moderation', href: '/ops/moderation' },
    { label: 'Users', href: '/ops/users' },
    { label: 'Audit', href: '/ops/audit' },
    { label: 'Config', href: '/ops/config' },
    { label: 'Observability', href: '/ops/observability' },
    { label: 'Agents', href: '/ops/agents' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="h-14 border-b bg-white px-4 flex items-center justify-between">
        <div className="font-semibold">Ops Console</div>
        <div className="text-sm text-gray-600">{email ?? '—'}</div>
      </header>
      <div className="flex">
        <aside className="w-56 border-r bg-white min-h-screen p-3">
          <div className="text-xs uppercase text-gray-500 mb-2">Navigation</div>
          <nav className="space-y-1">
            {nav.map((item) => (
              <Link key={item.href} href={item.href as any} className="block px-3 py-2 rounded hover:bg-gray-100">
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}


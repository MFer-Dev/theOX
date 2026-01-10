import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Ops Console',
  description: 'Internal ops console for GenMe',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <main className="max-w-5xl mx-auto p-6 space-y-4">{children}</main>
      </body>
    </html>
  );
}


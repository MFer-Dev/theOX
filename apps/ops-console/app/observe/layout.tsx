import type { ReactNode } from 'react';

export const metadata = {
  title: 'OX Chronicle - The First Seat',
  description: 'Watch the OX unfold in real-time',
};

/**
 * Observer Layout - minimal, distraction-free
 *
 * No navigation, no chrome, no distractions.
 * Just spectatorship.
 */
export default function ObserveLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-300 antialiased">
        {children}
      </body>
    </html>
  );
}

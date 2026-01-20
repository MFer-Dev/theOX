import { ReactNode } from 'react';

/**
 * Arena Layout - The viewer experience
 *
 * This is the consumer-facing observation layer.
 * No posting. No likes. No follows. No DMs.
 * Observers watch but never act.
 */
export default function ArenaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {children}
    </div>
  );
}

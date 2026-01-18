import Link from 'next/link';

const links = [
  { href: '/observe', label: 'OX Chronicle (Observer)' },
  { href: '/admin/users', label: 'Admin: Users' },
  { href: '/admin/cred-ledger', label: 'Admin: Cred Ledger' },
  { href: '/moderation/queue', label: 'Moderation Queue' },
  { href: '/trustgraph/user/demo', label: 'TrustGraph User' },
  { href: '/notes/queue', label: 'Notes Queue' },
  { href: '/support/tickets', label: 'Support Tickets' },
  { href: '/analytics/dashboards', label: 'Analytics Dashboards' },
  { href: '/grc/dsar', label: 'GRC DSAR' },
  { href: '/grc/audit-logs', label: 'GRC Audit Logs' },
  { href: '/integrity/triage-suggestions', label: 'Integrity Triage' },
  { href: '/purge/surge', label: 'Purge Surge' },
  { href: '/system/materializer', label: 'Materializer Status' },
  { href: '/safety/flags', label: 'Safety Flags' },
  { href: '/safety/appeals', label: 'Safety Appeals' },
];

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Ops Console</h1>
      <p className="text-sm text-slate-600">
        Internal administration, moderation, trust, and compliance surfaces.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href as any}
            className="rounded border bg-white px-4 py-3 shadow-sm hover:border-slate-400"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}


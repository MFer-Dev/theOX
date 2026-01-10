'use client';
import { Role } from '@platform/security';
import React from 'react';
import { opsClient } from '../src/api/opsClient';

type Props = {
  allowed: Role[];
  children: React.ReactNode;
};

export const RbacGuard: React.FC<Props> = ({ allowed, children }) => {
  const [role, setRole] = React.useState<Role | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    opsClient
      .me()
      .then((s: any) => setRole((s?.user?.role as Role) ?? null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-gray-600">Loading…</div>;
  if (!role || !allowed.includes(role)) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Access denied. Required roles: {allowed.join(', ')}. Current: {role ?? 'none'}
      </div>
    );
  }
  return <>{children}</>;
};


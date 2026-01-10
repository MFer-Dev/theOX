"use client";
import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CredLedger } from '../../../../src/screens/CredLedger';

function Inner() {
  const sp = useSearchParams();
  const userId = sp.get('user_id') ?? '';
  if (!userId) return <div className="p-4 text-sm text-gray-600">Provide `?user_id=`.</div>;
  return <CredLedger userId={userId} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-600">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}


import { redirect } from 'next/navigation';

export default function CredLedgerPage({ searchParams }: { searchParams: { user_id?: string } }) {
  const userId = searchParams?.user_id;
  if (!userId) redirect('/ops/cred/ledger');
  redirect(`/ops/cred/ledger?user_id=${encodeURIComponent(userId)}`);
}


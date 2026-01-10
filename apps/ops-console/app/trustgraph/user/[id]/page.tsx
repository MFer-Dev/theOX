import { redirect } from 'next/navigation';

type Props = { params: { id: string } };

export default function TrustUserPage({ params }: Props) {
  redirect(`/ops/trust/user/${encodeURIComponent(params.id)}`);
}


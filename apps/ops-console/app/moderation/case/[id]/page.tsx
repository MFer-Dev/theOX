import { redirect } from 'next/navigation';

type Props = { params: { id: string } };

export default function ModerationCasePage({ params }: Props) {
  redirect(`/ops/moderation/${encodeURIComponent(params.id)}`);
}


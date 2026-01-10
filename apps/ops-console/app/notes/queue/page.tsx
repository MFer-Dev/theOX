import { RbacGuard } from '../../../components/RbacGuard';
import { Role } from '@platform/security';

export default function NotesQueuePage() {
  return (
    <RbacGuard allowed={[Role.IntegrityOps]}>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Community Notes Queue</h2>
        <p className="text-sm text-slate-600">Review, vote, and feature candidate notes.</p>
      </section>
    </RbacGuard>
  );
}


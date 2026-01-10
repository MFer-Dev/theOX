import { RbacGuard } from '../../../components/RbacGuard';
import { Role } from '@platform/security';

export default function DsarPage() {
  return (
    <RbacGuard allowed={[Role.GRC]}>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">DSAR Tracking</h2>
        <p className="text-sm text-slate-600">Manage data subject access requests.</p>
      </section>
    </RbacGuard>
  );
}


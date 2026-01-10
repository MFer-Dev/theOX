import { RbacGuard } from '../../../components/RbacGuard';
import { Role } from '@platform/security';

export default function DashboardsPage() {
  return (
    <RbacGuard allowed={[Role.DataOps]}>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Analytics Dashboards</h2>
        <p className="text-sm text-slate-600">Cohort and purge window metrics placeholder.</p>
      </section>
    </RbacGuard>
  );
}


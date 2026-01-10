import { RbacGuard } from '../../../components/RbacGuard';
import { Role } from '@platform/security';

export default function TicketsPage() {
  return (
    <RbacGuard allowed={[Role.SupportOps]}>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Support Tickets</h2>
        <p className="text-sm text-slate-600">Integrate with Zendesk/ServiceNow here.</p>
      </section>
    </RbacGuard>
  );
}


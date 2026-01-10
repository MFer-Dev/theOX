import { RequestContext } from '@platform/shared';

export enum Role {
  CoreOps = 'core_ops',
  SafetyOps = 'safety_ops',
  IntegrityOps = 'integrity_ops',
  GraphOps = 'graph_ops',
  DataOps = 'data_ops',
  GRC = 'grc',
  SupportOps = 'support_ops',
  SRE = 'sre',
}

export type ResourceAction = {
  resource: string;
  action: 'read' | 'write' | 'execute';
};

export type AccessRequest = RequestContext & {
  role: Role;
  resource: string;
  action: ResourceAction['action'];
  attributes?: Record<string, string | number | boolean>;
};

type PolicyRule = {
  resource: string;
  actions: ResourceAction['action'][];
  roles: Role[];
  predicate?: (req: AccessRequest) => boolean;
};

const policy: PolicyRule[] = [
  { resource: 'purge_schedule', actions: ['write'], roles: [Role.CoreOps, Role.SRE] },
  { resource: 'moderation_queue', actions: ['read'], roles: [Role.SafetyOps, Role.IntegrityOps] },
  { resource: 'moderation_action', actions: ['write'], roles: [Role.SafetyOps] },
  { resource: 'trust_recompute', actions: ['execute'], roles: [Role.GraphOps] },
  // Ops console / admin gateway
  { resource: 'ops_users', actions: ['read'], roles: [Role.CoreOps, Role.SupportOps, Role.SafetyOps, Role.IntegrityOps, Role.SRE] },
  { resource: 'ops_audit', actions: ['read'], roles: [Role.CoreOps, Role.GRC, Role.SRE] },
  { resource: 'ops_config', actions: ['read'], roles: [Role.CoreOps, Role.SRE] },
  { resource: 'ops_purge', actions: ['read'], roles: [Role.CoreOps, Role.SRE] },
  { resource: 'ops_integrity', actions: ['read'], roles: [Role.IntegrityOps, Role.CoreOps] },
  { resource: 'ops_trust', actions: ['read'], roles: [Role.GraphOps, Role.DataOps, Role.CoreOps] },
  { resource: 'ops_cred', actions: ['read'], roles: [Role.DataOps, Role.CoreOps] },
  { resource: 'ops_system', actions: ['read'], roles: [Role.CoreOps, Role.SRE] },
  { resource: 'ops_moderation_queue', actions: ['read'], roles: [Role.SafetyOps, Role.IntegrityOps, Role.CoreOps] },
  { resource: 'ops_moderation_action', actions: ['write'], roles: [Role.SafetyOps, Role.CoreOps] },
  { resource: 'ops_tools', actions: ['execute'], roles: [Role.CoreOps, Role.SafetyOps, Role.SRE] },
  { resource: 'ops_safety', actions: ['read'], roles: [Role.CoreOps, Role.SafetyOps, Role.SupportOps, Role.IntegrityOps] },
  { resource: 'ops_safety', actions: ['write'], roles: [Role.CoreOps, Role.SafetyOps] },
];

export const isAllowed = (request: AccessRequest): boolean => {
  return policy.some((rule) => {
    if (rule.resource !== request.resource) return false;
    if (!rule.actions.includes(request.action)) return false;
    if (!rule.roles.includes(request.role)) return false;
    if (rule.predicate) {
      return rule.predicate(request);
    }
    return true;
  });
};


import type { PushProvider, PushTarget, PushMessage } from '../provider';

export const createApnsStubProvider = (): PushProvider => {
  return {
    name: 'apns_stub',
    async send(_target: PushTarget, _msg: PushMessage) {
      throw new Error('apns_not_configured');
    },
  };
};



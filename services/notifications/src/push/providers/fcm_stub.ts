import type { PushProvider, PushTarget, PushMessage } from '../provider';

export const createFcmStubProvider = (): PushProvider => {
  return {
    name: 'fcm_stub',
    async send(_target: PushTarget, _msg: PushMessage) {
      throw new Error('fcm_not_configured');
    },
  };
};



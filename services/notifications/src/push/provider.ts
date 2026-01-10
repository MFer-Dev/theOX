export type PushPlatform = 'ios' | 'android';

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushTarget = {
  platform: PushPlatform;
  token: string;
};

export interface PushProvider {
  name: string;
  send: (target: PushTarget, msg: PushMessage) => Promise<{ ok: boolean; provider: string; id?: string }>;
}



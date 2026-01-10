// SCS (Social Credit Score) and Trust Weight helpers.
// These are client-side helpers to display and reason about signal strength.
// Core scoring runs server-side; this file mirrors the conceptual model for UI.

export type TrustWeight = {
  value: number; // internal trust multiplier, >0
  sources?: string[]; // e.g., verified identity, upheld reports, AI disclosure
};

export type IcsEvent =
  | { type: 'post'; depth?: number; novelty?: number }
  | { type: 'reply'; depth: number; receivedReplies?: number }
  | { type: 'reaction'; strength?: number }
  | { type: 'report_upheld'; severity?: number }
  | { type: 'report_rejected'; severity?: number };

export type IcsDelta = {
  postDelta: number;
  userDelta: number;
};

const actionWeight = (e: IcsEvent) => {
  switch (e.type) {
    case 'post':
      return 1;
    case 'reply':
      return 1.5;
    case 'reaction':
      return 0.6 * (e.strength ?? 1);
    case 'report_upheld':
      return -2 * (e.severity ?? 1);
    case 'report_rejected':
      return 0.2 * (e.severity ?? 1);
    default:
      return 1;
  }
};

const depthWeight = (depth?: number) => {
  if (!depth || depth <= 1) return 1;
  return Math.min(2, 1 + Math.log(1 + depth));
};

const noveltyWeight = (novelty?: number) => {
  if (novelty === undefined || novelty === null) return 1;
  return Math.max(0.5, Math.min(1.2, novelty));
};

export const computeIcsDelta = (trust: TrustWeight, event: IcsEvent, qualityWeight = 1): IcsDelta => {
  const base = trust.value * actionWeight(event) * depthWeight((event as any).depth) * noveltyWeight((event as any).novelty) * qualityWeight;
  // Dampen spam/volume via log scaling
  const postDelta = base;
  const userDelta = Math.log1p(Math.abs(base)) * Math.sign(base);
  return { postDelta, userDelta };
};

export const formatScs = (v?: number | null) => {
  if (v === null || v === undefined) return '–';
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}m`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return Math.round(v).toString();
};


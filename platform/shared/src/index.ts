import { v4 as uuidv4 } from 'uuid';

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
};

export const createProblemDetails = (
  status: number,
  title: string,
  detail?: string,
  type = 'about:blank',
  correlationId?: string,
): ProblemDetails => ({
  type,
  title,
  status,
  detail,
  correlationId,
});

export type CorrelationContext = {
  correlationId: string;
};

export const ensureCorrelationId = (existing?: string | string[]): string => {
  if (Array.isArray(existing)) {
    return existing[0] ?? uuidv4();
  }
  return existing ?? uuidv4();
};

export type GenerationCohort = 'genz' | 'millennial' | 'genx' | 'boomer';

export type RequestContext = {
  actorId: string;
  actorGeneration: GenerationCohort;
  purgeContext?: 'active' | 'inactive';
  correlationId: string;
};

export enum AssumptionType {
  LivedExperience = 'lived_experience',
  HistoricalContext = 'historical_context',
  StatisticalData = 'statistical_data',
  MoralFramework = 'moral_framework',
  ProfessionalExpertise = 'professional_expertise',
  PersonalOpinion = 'personal_opinion',
}

export enum EndorseIntent {
  Clear = 'clear',
  WellSupported = 'well_supported',
  Bridging = 'bridging',
  Insightful = 'insightful',
}

export enum CredReasonCode {
  ClaimValue = 'claim_value',
  ReplyValue = 'reply_value',
  EndorsementGiven = 'endorsement_given',
  EndorsementReceived = 'endorsement_received',
  NoteValue = 'note_value',
}

export enum ModerationReasonCode {
  Harassment = 'harassment',
  Misinformation = 'misinformation',
  OffTopic = 'off_topic',
  Dangerous = 'dangerous',
  Spam = 'spam',
}

export enum AdminReasonCode {
  Compliance = 'compliance',
  Security = 'security',
  AbuseMitigation = 'abuse_mitigation',
  PolicyEnforcement = 'policy_enforcement',
}

export type ActorReasonCode = CredReasonCode | ModerationReasonCode | AdminReasonCode;

export type StandardResponse<T> = {
  data: T;
  correlationId: string;
};

export const runMigrations = async (_service: string) => {
  // placeholder for shared migration runner
  return { status: 'ok' };
};

export * from './persistence';
export * from './auth';
export * from './rate-limit';


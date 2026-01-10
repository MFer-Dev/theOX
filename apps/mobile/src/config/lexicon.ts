export const APP_NAME = 'Trybl';

export const GROUP_SINGULAR = 'Trybe';
export const GROUP_PLURAL = 'Trybes';

export const EVENT_NAME = 'The Gathering';
export const EVENT_SHORT = 'Gathering';

export const GENERATION_LABELS: Record<string, string> = {
  boomer: 'Boomers',
  genx: 'Gen X',
  millennial: 'Millennials',
  genz: 'Gen Z',
  genalpha: 'Gen Alpha',
};

const labelFor = (gen?: string | null) => GENERATION_LABELS[gen ?? ''] ?? gen ?? 'Your Generation';

export const formatTrybeLabel = (gen?: string | null) => `${labelFor(gen)} ${GROUP_SINGULAR}`;
export const formatMyTrybe = (gen?: string | null) => `My ${GROUP_SINGULAR}: ${labelFor(gen)}`;
export const formatNextGathering = (range: string) => `Next ${EVENT_SHORT}: ${range}`;
export const formatGatheringLive = (remaining: string) => `${EVENT_NAME} is live — ends in ${remaining}`;

// Theme aliasing (no token renames; maps to existing themes)
export const TRYBE_THEME = 'default';
export const GATHERING_THEME = 'purge';


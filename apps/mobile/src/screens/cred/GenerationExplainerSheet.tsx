import React from 'react';
import { Sheet, Section, AppText, AppButton } from '../../ui';

const label = (g?: string | null) => {
  const v = String(g ?? '').toLowerCase();
  if (v === 'genz') return 'Gen Z';
  if (v === 'millennial') return 'Millennial';
  if (v === 'genx') return 'Gen X';
  if (v === 'boomer') return 'Boomer';
  return g ? String(g) : 'Unknown';
};

export function GenerationExplainerSheet({
  open,
  onClose,
  generation,
}: {
  open: boolean;
  onClose: () => void;
  generation?: string | null;
}) {
  return (
    <Sheet isOpen={open} onClose={onClose}>
      <Section title="Generation" subtitle="Context, not a boundary.">
        <AppText variant="body">
          This ring indicates the author’s generation cohort: <AppText variant="body" fontWeight="800">{label(generation)}</AppText>.
        </AppText>
        <AppText variant="caption" color="$gray10">
          In Tribal World, your Trybe scopes most conversation. In The Gathering, cohorts remain visible for context while content mixes across Trybes.
        </AppText>
        <AppButton tone="primary" onPress={onClose}>
          Got it
        </AppButton>
      </Section>
    </Sheet>
  );
}



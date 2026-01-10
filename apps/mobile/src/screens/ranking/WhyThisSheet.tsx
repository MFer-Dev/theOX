import React from 'react';
import { Sheet, Section, AppText, Card } from '../../ui';

type WhyItem = { code?: string; label?: string; weight?: number } | string;

export function WhyThisSheet({
  open,
  onClose,
  why,
  algo,
}: {
  open: boolean;
  onClose: () => void;
  why: WhyItem[] | null;
  algo?: string | null;
}) {
  const items = Array.isArray(why) ? why : [];
  return (
    <Sheet isOpen={open} onClose={onClose}>
      <Section title="Why you saw this" subtitle={algo ? `Algorithm: ${algo}` : undefined}>
        <Card bordered>
          {items.length ? (
            items.map((w, idx) => {
              const label =
                typeof w === 'string'
                  ? w
                  : typeof (w as any)?.label === 'string'
                    ? String((w as any).label)
                    : typeof (w as any)?.code === 'string'
                      ? String((w as any).code)
                      : 'Reason';
              return (
                <AppText key={idx} variant="body">
                  - {label}
                </AppText>
              );
            })
          ) : (
            <AppText variant="body">No explanation available yet.</AppText>
          )}
          <AppText variant="caption" color="$gray10" marginTop="$2">
            Explanations are best-effort and may change as the ranking system evolves.
          </AppText>
        </Card>
      </Section>
    </Sheet>
  );
}



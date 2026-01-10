import React from 'react';
import { Card, YStack, XStack } from 'tamagui';
import { AppText, AppButton, Badge } from '../primitives';
import { formatScs } from '../../signal/scores';
import { formatTrybeLabel } from '../../config/lexicon';

export const lists = {
  feedRow: {
    gap: 6,
    padding: 12,
    // Pattern: Bento feed rows (compact metadata stacking, 12px pad, 6px gaps)
    metadataOrder: ['generation', 'topic', 'assumption'],
    truncation: { bodyLines: 3, metaLines: 1 },
    tapTarget: { minHeight: 48 },
  },
  settingsRow: {
    height: 52,
    padding: 12,
    // Pattern: Takeout settings rows (dense height ~52px)
  },
  replyRow: {
    padding: 10,
  },
  noteRow: {
    padding: 12,
  },
};

type FeedRowProps = {
  body: string;
  generation?: string | null;
  topic?: string | null;
  assumption?: string | null;
  ics?: number | null;
  onPress?: () => void;
};

export const FeedRow = ({ body, generation, topic, assumption, ics, onPress }: FeedRowProps) => (
  <Card padding="$3" bordered>
    <YStack gap="$2">
      <AppText variant="body" numberOfLines={3} fontSize={16} lineHeight={22}>
        {body}
      </AppText>
      <XStack alignItems="center" gap="$2" flexWrap="wrap">
        <AppText variant="meta" numberOfLines={1}>
          Trybe: {formatTrybeLabel(generation)} • Topic: {topic || 'none'} • Assumption: {assumption || 'n/a'}
        </AppText>
        <Badge tone="muted">Social Credit {formatScs(ics)}</Badge>
      </XStack>
      {onPress ? (
        <AppButton tone="secondary" onPress={onPress}>
          Open thread
        </AppButton>
      ) : null}
    </YStack>
  </Card>
);



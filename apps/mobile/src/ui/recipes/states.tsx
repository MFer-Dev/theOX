import React from 'react';
import { YStack } from 'tamagui';
import { AppText, AppButton, Skeleton } from '../primitives';

export const states = {
  loading: { spinner: true, skeleton: true },
  empty: { title: 'Nothing here yet', body: 'Check back soon.' },
  error: { retry: true },
  blocked: { headline: 'Action blocked', detail: 'See safety rules.' },
};

type StateProps = {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export const EmptyState = ({ title = 'Nothing here yet', body, actionLabel, onAction }: StateProps) => (
  <YStack gap="$2" alignItems="flex-start">
    <AppText variant="title">{title}</AppText>
    {body ? <AppText variant="body">{body}</AppText> : null}
    {onAction && actionLabel ? (
      <AppButton tone="primary" onPress={onAction}>
        {actionLabel}
      </AppButton>
    ) : null}
  </YStack>
);

export const ErrorState = ({ title = 'Something went wrong', body, actionLabel = 'Retry', onAction }: StateProps) => (
  <YStack gap="$2" alignItems="flex-start">
    <AppText variant="title" color="$red10">
      {title}
    </AppText>
    {body ? <AppText variant="body">{body}</AppText> : null}
    {onAction ? (
      <AppButton tone="secondary" onPress={onAction}>
        {actionLabel}
      </AppButton>
    ) : null}
  </YStack>
);

export const BlockedState = ({ title = 'Action blocked', body }: StateProps) => (
  <YStack gap="$2" alignItems="flex-start">
    <AppText variant="title">{title}</AppText>
    {body ? <AppText variant="body">{body}</AppText> : null}
  </YStack>
);

export const LoadingState = ({ lines = 3 }: { lines?: number }) => (
  <YStack gap="$2">
    {Array.from({ length: lines }).map((_, idx) => (
      <Skeleton key={idx} height={14} width={idx % 2 === 0 ? '80%' : '60%'} />
    ))}
  </YStack>
);



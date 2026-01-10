import React from 'react';
import { Text, YStack, Spinner } from 'tamagui';
import { AppButton } from './Button';

export const LoadingState = () => (
  <YStack alignItems="center" justifyContent="center" padding="$4" gap="$2">
    <Spinner size="large" />
    <Text>Loading...</Text>
  </YStack>
);

export const EmptyState = ({ title = 'Nothing here yet', body = 'Check back soon.' }) => (
  <YStack alignItems="center" justifyContent="center" padding="$4" gap="$2">
    <Text fontWeight="700">{title}</Text>
    <Text color="$gray10">{body}</Text>
  </YStack>
);

export const ErrorState = ({ message = 'Something went wrong', onRetry }: { message?: string; onRetry?: () => void }) => (
  <YStack alignItems="center" justifyContent="center" padding="$4" gap="$3">
    <Text color="$red10">{message}</Text>
    {onRetry && (
      <AppButton tone="primary" onPress={onRetry}>
        Retry
      </AppButton>
    )}
  </YStack>
);

export const BlockedState = ({ reason }: { reason: string }) => (
  <YStack alignItems="center" justifyContent="center" padding="$4" gap="$2">
    <Text fontWeight="700">Action blocked</Text>
    <Text color="$gray10">{reason}</Text>
  </YStack>
);


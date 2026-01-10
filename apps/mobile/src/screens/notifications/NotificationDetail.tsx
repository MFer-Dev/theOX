import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  route: { params?: { title?: string; body?: string; target?: { route: string; params?: any } } };
  navigation: any;
};

export default function NotificationDetail({ route, navigation }: Props) {
  const { title, body, target } = route?.params ?? {};
  return (
    <Screen>
      <Section title={title ?? 'Notification'}>
        <AppText variant="body">{body ?? 'Details unavailable.'}</AppText>
        {target?.route ? (
          <AppButton tone="primary" onPress={() => navigation?.navigate?.(target.route as never, target.params)}>
            View
          </AppButton>
        ) : null}
        <AppButton tone="ghost" onPress={() => navigation?.goBack?.()}>
          Back
        </AppButton>
      </Section>
    </Screen>
  );
}


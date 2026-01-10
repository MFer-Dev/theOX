import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  route: any;
  navigation: any;
  onBlock?: (userId: string) => Promise<void> | void;
};

export default function BlockUserScreen({ route, navigation, onBlock }: Props) {
  const userId = route?.params?.userId;
  return (
    <Screen>
      <Section title="Block user?">
        <AppText variant="body">They will not interact with you or see your content.</AppText>
        <AppButton
          tone="destructive"
          onPress={async () => {
            if (!userId) return;
            await onBlock?.(userId);
            navigation?.goBack?.();
          }}
        >
          Confirm Block
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation?.goBack?.()}>
          Cancel
        </AppButton>
      </Section>
    </Screen>
  );
}


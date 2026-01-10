import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';
import { useNavigation } from '@react-navigation/native';
import { EVENT_NAME, formatNextGathering, formatGatheringLive } from '../../config/lexicon';

type Props = {
  purgeActive?: boolean;
  purgeStartsAt?: string | null;
  purgeEndsAt?: string | null;
};

export default function StatusScreen({ purgeActive, purgeStartsAt, purgeEndsAt }: Props) {
  const navigation = useNavigation<any>();
  const live = purgeActive && purgeEndsAt;
  const upcoming = !purgeActive && purgeStartsAt;

  return (
    <Screen>
      <Section title="Status">
        <AppText variant="body">Gateway/services reachable.</AppText>
        {live ? <AppText variant="body">{formatGatheringLive(purgeEndsAt!)}</AppText> : null}
        {upcoming ? <AppText variant="body">{formatNextGathering(purgeStartsAt!)}</AppText> : null}
        {!live && !upcoming ? <AppText variant="caption">{EVENT_NAME} not scheduled.</AppText> : null}
      </Section>
      <Section title="Tools">
        <AppButton tone="secondary" onPress={() => navigation.navigate('Kitchen' as never)}>
          Open Kitchen Sink
        </AppButton>
      </Section>
    </Screen>
  );
}


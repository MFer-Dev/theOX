import React from 'react';
import { Screen, Section } from '../../ui';
import { BlockedState } from '../../ui/recipes/states';

type Props = {
  route?: { params?: { message?: string } };
  navigation?: any;
};

export default function RestrictionNoticeScreen({ route, navigation }: Props) {
  const message = route?.params?.message ?? 'Action not allowed due to policy.';
  return (
    <Screen>
      <Section title="Restricted">
        <BlockedState title="Restricted" body={message} />
      </Section>
    </Screen>
  );
}


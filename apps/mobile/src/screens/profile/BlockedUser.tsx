import React from 'react';
import { Screen, Section } from '../../ui';
import { BlockedState } from '../../ui/recipes/states';

export default function BlockedUserScreen(_props: any) {
  return (
    <Screen>
      <Section title="User blocked">
        <BlockedState title="User blocked" body="You cannot view this profile." />
      </Section>
    </Screen>
  );
}


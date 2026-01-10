import React from 'react';
import { YStack, XStack, Text, Button } from 'tamagui';
import { Sheet, Badge } from '../ui';
import { EVENT_NAME } from '../config/lexicon';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  reason: string;
  purgeActive: boolean;
};

const BlockedActionSheet = ({ isOpen, onClose, reason, purgeActive }: Props) => {
  return (
    <Sheet isOpen={isOpen} onClose={onClose}>
      <YStack gap="$3">
        <Text fontSize={18} fontWeight="700">
          Action blocked
        </Text>
        <Text>{reason}</Text>
        <XStack alignItems="center" gap="$2">
          <Badge tone={purgeActive ? 'accent' : 'muted'}>
            {purgeActive ? `${EVENT_NAME} LIVE` : `${EVENT_NAME} inactive`}
          </Badge>
        </XStack>
        <Text>
          During {EVENT_NAME}, cross-Trybe replies and endorsements are temporarily allowed. Otherwise, stay within your Trybe.
        </Text>
        <Button onPress={onClose}>Close</Button>
      </YStack>
    </Sheet>
  );
};

export default BlockedActionSheet;


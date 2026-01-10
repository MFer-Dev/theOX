import React from 'react';
import { Card as TCard, CardProps } from 'tamagui';
import { APP_RADIUS } from './style';

export const Card = (props: CardProps) => {
  const bordered = Boolean((props as any)?.bordered);
  return (
    <TCard
      padding="$4"
      borderRadius={APP_RADIUS}
      backgroundColor="$backgroundStrong"
      borderWidth={bordered ? 1 : 0}
      borderColor={bordered ? '$borderColor' : 'transparent'}
      shadowColor="#000"
      shadowOpacity={bordered ? 0 : 0.06}
      shadowRadius={bordered ? 0 : 12}
      shadowOffset={bordered ? { width: 0, height: 0 } : { width: 0, height: 6 }}
      elevation={bordered ? 0 : 1}
      pressStyle={{ opacity: 0.9 }}
      {...props}
    />
  );
};

export const AppCard = Card;


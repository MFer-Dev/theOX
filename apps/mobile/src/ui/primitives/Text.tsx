import React from 'react';
import { Text as TText, TextProps } from 'tamagui';
import { typography, type TypeVariant } from '../recipes/typography';

const lineHeights: Record<TypeVariant, number> = {
  display: 36,
  title: 22,
  body: 22,
  meta: 18,
  caption: 16,
};

export const AppText = ({ variant = 'body', children, ...rest }: TextProps & { variant?: TypeVariant }) => (
  <TText
    color={variant === 'meta' || variant === 'caption' ? '$gray10' : '$color'}
    lineHeight={lineHeights[variant]}
    {...typography[variant]}
    {...rest}
  >
    {children}
  </TText>
);


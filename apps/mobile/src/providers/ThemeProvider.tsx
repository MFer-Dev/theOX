import React, { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  mode?: string;
};

export const ThemeProvider = ({ children }: Props) => <>{children}</>;


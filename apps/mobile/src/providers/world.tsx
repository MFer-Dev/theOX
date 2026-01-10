import React, { createContext, useContext, useMemo } from 'react';

export type WorldMode = 'tribal' | 'gathering';

const Ctx = createContext<WorldMode>('tribal');

export function WorldProvider({ world, children }: { world: WorldMode; children: React.ReactNode }) {
  const value = useMemo(() => world, [world]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorld() {
  return useContext(Ctx);
}



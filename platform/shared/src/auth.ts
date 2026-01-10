import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { GenerationCohort } from './index';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

export type JwtPayload = {
  sub: string;
  generation: GenerationCohort | null;
  verified: boolean;
  // session id (set by Identity). Optional for backwards compatibility.
  sid?: string;
};

export const signTokens = (payload: JwtPayload) => {
  const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET || 'access_secret', {
    expiresIn: ACCESS_TOKEN_TTL,
  });
  const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET || 'refresh_secret', {
    expiresIn: REFRESH_TOKEN_TTL,
  });
  return { accessToken, refreshToken };
};

export const verifyAccess = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'access_secret') as JwtPayload;
  } catch {
    return null;
  }
};

export const verifyRefresh = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || 'refresh_secret') as JwtPayload;
  } catch {
    return null;
  }
};

export const hashValue = async (value: string): Promise<string> => bcrypt.hash(value, 10);
export const compareHash = async (value: string, hash: string): Promise<boolean> =>
  bcrypt.compare(value, hash);


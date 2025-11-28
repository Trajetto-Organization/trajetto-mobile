import { JWTPayload } from "../types";

export const parseJwt = (token: string): JWTPayload | null => {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch (error) {
    return null;
  }
};

export const isTokenExpired = (token: string): boolean => {
  const payload = parseJwt(token);
  if (!payload) return true;

  const currentTime = Date.now() / 1000;
  return payload.exp < currentTime;
};

export const getTokenExpirationTime = (token: string): number | null => {
  const payload = parseJwt(token);
  return payload?.exp || null;
};

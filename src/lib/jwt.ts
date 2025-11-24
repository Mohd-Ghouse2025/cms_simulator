import { Buffer } from "buffer";

type JwtPayload = Record<string, unknown>;

const base64UrlDecode = (segment: string): string => {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const paddedSegment = padded + "=".repeat(padLength);
  if (typeof window === "undefined") {
    return Buffer.from(paddedSegment, "base64").toString("utf-8");
  }
  return atob(paddedSegment);
};

export const decodeJwt = (token?: string | null): JwtPayload | null => {
  if (!token) {
    return null;
  }
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }
    const decoded = base64UrlDecode(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

export const getUserIdFromToken = (token?: string | null): number | null => {
  const payload = decodeJwt(token);
  if (!payload) {
    return null;
  }
  const raw =
    payload.user_id ??
    payload.userId ??
    payload.sub ??
    null;

  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

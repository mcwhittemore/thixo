import type { User } from "../contract.js";

/** A5. The claims of a token Thixo issued. Times are seconds since the epoch. */
export interface TokenClaims {
  sub: string;
  scopes: string[];
  groups?: string[];
  iat: number;
  exp: number;
}

export const TOKEN_LIFETIME_SECONDS = 15 * 60;

export type TokenFailure = "malformed" | "signature" | "expired";

export class TokenError extends Error {
  readonly reason: TokenFailure;
  constructor(reason: TokenFailure, message: string) {
    super(message);
    this.name = "TokenError";
    this.reason = reason;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new TokenError("malformed", "Token is not base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

const HEADER = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));

export interface IssuedToken {
  token: string;
  claims: TokenClaims;
  expiresAt: string;
}

/** Signs an HS256 JWT for `user`, good for 15 minutes from `now` (milliseconds). */
export async function signToken(secret: string, user: User, now: number = Date.now()): Promise<IssuedToken> {
  const iat = Math.floor(now / 1000);
  const claims: TokenClaims = { sub: user.id, scopes: [...user.scopes], iat, exp: iat + TOKEN_LIFETIME_SECONDS };
  if (user.groups) claims.groups = [...user.groups];
  const signingInput = `${HEADER}.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(signingInput));
  return { token: `${signingInput}.${base64url(new Uint8Array(signature))}`, claims, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

/** Checks the signature and the expiry and returns the claims. Throws `TokenError` otherwise. */
export async function verifyToken(secret: string, token: string, now: number = Date.now()): Promise<TokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("malformed", "Token is not a JWT");
  const [header, payload, signature] = parts;
  let headerJson: { alg?: unknown };
  try {
    headerJson = JSON.parse(decoder.decode(fromBase64url(header)));
  } catch {
    throw new TokenError("malformed", "Token header is not JSON");
  }
  if (headerJson.alg !== "HS256") throw new TokenError("malformed", "Token is not signed with HS256");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromBase64url(signature), encoder.encode(`${header}.${payload}`));
  if (!ok) throw new TokenError("signature", "Token signature does not match");
  let claims: Partial<TokenClaims>;
  try {
    claims = JSON.parse(decoder.decode(fromBase64url(payload)));
  } catch {
    throw new TokenError("malformed", "Token claims are not JSON");
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number" || !Array.isArray(claims.scopes) || !claims.scopes.every((s) => typeof s === "string")) {
    throw new TokenError("malformed", "Token is missing claims");
  }
  if (claims.exp * 1000 <= now) throw new TokenError("expired", "Token has expired");
  return claims as TokenClaims;
}

export function userOf(claims: TokenClaims): User {
  return { id: claims.sub, scopes: claims.scopes, ...(claims.groups ? { groups: claims.groups } : {}) };
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_LIFETIME_SECONDS, TokenError, signToken, verifyToken } from "../src/server/tokens.js";

const user = { id: "ana", scopes: ["todos.read", "todos.write"], groups: ["design"] };
const now = Date.UTC(2026, 10, 22, 12, 0, 0);

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof TokenError);
    return error.reason;
  }
  return "none";
}

test("a token carries sub, scopes and groups and lasts 15 minutes", async () => {
  const { token, claims, expiresAt } = await signToken("secret", user, now);
  assert.equal(TOKEN_LIFETIME_SECONDS, 900);
  assert.equal(token.split(".").length, 3);
  assert.deepEqual(JSON.parse(atob(token.split(".")[0])), { alg: "HS256", typ: "JWT" });
  assert.equal(claims.exp - claims.iat, 900);
  assert.equal(expiresAt, new Date(now + 15 * 60_000).toISOString());
  const verified = await verifyToken("secret", token, now + 1000);
  assert.equal(verified.sub, "ana");
  assert.deepEqual(verified.scopes, user.scopes);
  assert.deepEqual(verified.groups, ["design"]);
});

test("a token expires", async () => {
  const { token } = await signToken("secret", user, now);
  await verifyToken("secret", token, now + 14 * 60_000);
  assert.equal(await reason(verifyToken("secret", token, now + 15 * 60_000)), "expired");
});

test("a token with another key, or tampered, is refused", async () => {
  const { token } = await signToken("secret", user, now);
  assert.equal(await reason(verifyToken("other", token, now)), "signature");

  const [header, payload, signature] = token.split(".");
  const forged = btoa(JSON.stringify({ ...JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))), scopes: ["thixo.data.admin"] }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(await reason(verifyToken("secret", `${header}.${forged}.${signature}`, now)), "signature");
  assert.equal(await reason(verifyToken("secret", `${header}.${payload}.${signature.slice(0, -2)}AA`, now)), "signature");
});

test("malformed tokens and alg none are refused", async () => {
  assert.equal(await reason(verifyToken("secret", "nonsense", now)), "malformed");
  assert.equal(await reason(verifyToken("secret", "a.b.c", now)), "malformed");
  const none = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
  const claims = btoa(JSON.stringify({ sub: "ana", scopes: [], exp: 9e9 })).replace(/=+$/, "");
  assert.equal(await reason(verifyToken("secret", `${none}.${claims}.`, now)), "malformed");
});

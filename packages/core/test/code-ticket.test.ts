import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_TICKET_SECONDS, checkCodeTicket, codeTicket } from "../src/server/tokens.js";

const now = Date.UTC(2026, 10, 22, 12, 0, 0);
const query = async (secret = "secret", user = "ana", plugin = "plg_a", version = 1) => new URLSearchParams(await codeTicket(secret, user, plugin, version, now));

test("a code ticket names its user for that plugin version, for five minutes", async () => {
  assert.equal(CODE_TICKET_SECONDS, 300);
  assert.equal(await checkCodeTicket("secret", await query(), "plg_a", 1, now), "ana");
  assert.equal(await checkCodeTicket("secret", await query(), "plg_a", 1, now + 299_000), "ana");
  assert.equal(await checkCodeTicket("secret", await query(), "plg_a", 1, now + 300_000), null, "expired");
});

test("a ticket is refused for another version, another plugin, another key, or with any part changed", async () => {
  const q = await query();
  assert.equal(await checkCodeTicket("secret", q, "plg_a", 2, now), null);
  assert.equal(await checkCodeTicket("secret", q, "plg_b", 1, now), null);
  assert.equal(await checkCodeTicket("other", q, "plg_a", 1, now), null);
  for (const [name, value] of [["u", "ben"], ["e", String(Number(q.get("e")) + 3600)], ["k", "AAAA"], ["k", "not base64!"]]) {
    const changed = new URLSearchParams(q);
    changed.set(name, value);
    assert.equal(await checkCodeTicket("secret", changed, "plg_a", 1, now), null, `${name} changed`);
  }
  for (const name of ["u", "e", "k"]) {
    const missing = new URLSearchParams(q);
    missing.delete(name);
    assert.equal(await checkCodeTicket("secret", missing, "plg_a", 1, now), null, `${name} missing`);
  }
});

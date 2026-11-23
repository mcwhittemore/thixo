import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthoringRefusal } from "thixo/contract";
import type { Fresh } from "./suite.js";

/** The authoring guard's rows: refusals and one block per user. */
export function registerGuardTests(freshAdapter: Fresh): void {
  const refusal = (over: Partial<AuthoringRefusal> = {}): AuthoringRefusal => ({
    id: `ref_${Math.random().toString(36).slice(2)}`,
    user: "ana",
    conversation: "c1",
    category: "credentials",
    reason: "It asks for a password.",
    trigger: "make a login box",
    from: "user",
    source: "agent",
    at: "2026-11-22T10:00:00.000Z",
    ...over,
  });

  test("refusals round-trip, oldest first, filtered by user and by time", async () => {
    const { data } = await freshAdapter();
    const a = refusal({ at: "2026-11-22T10:00:00.000Z", quote: "a password" });
    const b = refusal({ at: "2026-11-22T11:00:00.000Z", conversation: null, from: "data", source: "check" });
    const c = refusal({ at: "2026-11-22T09:00:00.000Z", user: "ben", category: "override" });
    for (const r of [a, b, c]) await data.addRefusal(r);

    assert.deepEqual(await data.listRefusals(), [c, a, b]);
    assert.deepEqual(await data.listRefusals({ user: "ana" }), [a, b]);
    assert.deepEqual(await data.listRefusals({ user: "ana", since: "2026-11-22T10:00:00.000Z" }), [b], "since is strictly after");
    assert.equal("quote" in (await data.listRefusals({ user: "ana" }))[1], false);
  });

  test("a block per user: put replaces, lifting keeps the record, list is newest first", async () => {
    const { data } = await freshAdapter();
    assert.equal(await data.getAuthoringBlock("ana"), null);
    await data.putAuthoringBlock({ user: "ana", at: "2026-11-22T10:00:00.000Z", reason: "three", refusals: ["r1", "r2", "r3"] });
    await data.putAuthoringBlock({ user: "ben", at: "2026-11-22T11:00:00.000Z", reason: "three", refusals: [] });
    assert.deepEqual(await data.getAuthoringBlock("ana"), { user: "ana", at: "2026-11-22T10:00:00.000Z", reason: "three", refusals: ["r1", "r2", "r3"] });
    await data.putAuthoringBlock({ user: "ana", at: "2026-11-22T10:00:00.000Z", reason: "three", refusals: ["r1", "r2", "r3"], liftedAt: "2026-11-22T12:00:00.000Z", liftedBy: "implementor" });
    assert.equal((await data.getAuthoringBlock("ana"))?.liftedBy, "implementor");
    assert.deepEqual((await data.listAuthoringBlocks()).map((b) => b.user), ["ben", "ana"]);
  });
}

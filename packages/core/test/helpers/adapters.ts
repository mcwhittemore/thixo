import type { Adapters, DataAdapter, User } from "../../src/contract.js";

/** A data adapter that only remembers users. Everything else fails loudly: these tests are about the app's side. */
export function memoryAdapters(): Adapters & { users: Map<string, User> } {
  const users = new Map<string, User>();
  const unused = () => {
    throw new Error("not used in this test");
  };
  const data = new Proxy(
    {
      async rememberUser(user: User) {
        users.set(user.id, user);
      },
      async recallUser(id: string) {
        return users.get(id) ?? null;
      },
    } as unknown as DataAdapter,
    { get: (target, key) => (key in target ? (target as never)[key] : unused) },
  );
  return { users, data, code: { put: unused, get: unused, openChange: unused } as never, build: { build: unused } as never };
}

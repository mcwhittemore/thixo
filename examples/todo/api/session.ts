// Sketch. Nothing here runs yet. See ../readme.md.
//
// The app's own login, standing in for whatever the implementor uses. It
// answers one question for Tailor: who is calling, and which scopes do they
// hold?

type Session = { userId: string; scopes: string[] };

export async function readSession(request: Request): Promise<Session | null> {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  // A real app would look the session up. This stand-in gives everyone the
  // same access except deleting.
  return {
    userId: "user-1",
    scopes: ["todos.read", "todos.write", "people.read"],
  };
}

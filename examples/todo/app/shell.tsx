// Sketch. Nothing here runs yet. See ../readme.md.
//
// The base app: the always-on functionality and the slots (S1). The
// implementor writes ordinary React. There is no frame, sandbox attribute or
// message handler here; <Slot> does that (S7).

import { useState } from "react";
import { Shell, Slot, AuthoringChat } from "tailor/shell";
import { main, todoDetail } from "./slots";

export default function App() {
  const [todoId, setTodoId] = useState<string | null>(null);

  return (
    <Shell>
      <header>
        <h1>Todos</h1>
        {/* Part 3: where a user asks for a plugin of their own. */}
        <AuthoringChat />
      </header>

      <main>
        <Slot is={main} on={{ select: ({ todoId }) => setTodoId(todoId) }} />
      </main>

      {todoId && (
        <aside>
          <Slot is={todoDetail} context={{ todoId }} />
        </aside>
      )}
    </Shell>
  );
}

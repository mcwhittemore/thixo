// Sketch. Nothing here runs yet. See ../../readme.md.
//
// A default plugin: the implementor ships it and every user has it. It goes
// through the same build as a plugin a user writes.
//
// Its scopes are not written anywhere. The build reads them from these
// imports (P2):
//   required: todos.read, todos.write   (from listTodos, createTodo, updateTodo)
//   optional: todos.delete              (from deleteTodo)
//   optional: people.read               (listTodos returns more with it)

import { useState } from "react";
import { definePlugin, useQuery } from "tailor/plugin";
import { Button, Checkbox, Stack, TextInput } from "tailor/ui";
import { main } from "@app/slots";
import { listTodos, createTodo, updateTodo } from "@app/sdk";
import { deleteTodo } from "@app/sdk/optional";

export default definePlugin(
  main,
  {
    name: "Todo list",
    description: "Every todo in one list. Add, tick off and delete.",
  },
  function TodoList({ emit }) {
    const todos = useQuery(listTodos);
    const [title, setTitle] = useState("");

    async function add() {
      await createTodo({ title });
      setTitle("");
      todos.refresh();
    }

    return (
      <Stack>
        <TextInput value={title} onChange={setTitle} onSubmit={add} placeholder="Add a todo" />

        {todos.data?.map((todo) => (
          <Stack key={todo.id} direction="row">
            <Checkbox
              checked={todo.done}
              onChange={(done) => updateTodo({ id: todo.id, done }).then(todos.refresh)}
            />
            <button onClick={() => emit.select({ todoId: todo.id })}>{todo.title}</button>

            {/* Present only when the user holds people.read. */}
            {todo.assignee && <span>{todo.assignee}</span>}

            {/* Grayed out for a user who can't delete (P5). */}
            <Button
              disabled={!deleteTodo.allowed}
              onClick={() => deleteTodo({ id: todo.id }).then(todos.refresh)}
            >
              Delete
            </Button>
          </Stack>
        ))}
      </Stack>
    );
  },
);

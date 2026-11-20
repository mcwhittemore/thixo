// Sketch. Nothing here runs yet. See ../../readme.md.
//
// The kind of plugin a user would ask the authoring chat for: "let me put a
// due date on a todo". It fills the panel beside the selected todo.
//
// Derived by the build (P13):
//   required: todos.read    (getTodo, and annotating Todo)
//   data:     annotation on todo { dueOn: date }
//             private store prefs { warnDaysBefore: number }

import { definePlugin, useAnnotation, useQuery, useStore } from "tailor/plugin";
import { DateInput, NumberInput, Stack, Text } from "tailor/ui";
import { todoDetail } from "@app/slots";
import { getTodo } from "@app/sdk";
import { due, prefs } from "./data";

export default definePlugin(
  todoDetail,
  {
    name: "Due dates",
    description: "Give a todo a due date and see a warning when it is close.",
  },
  function DueDate({ context }) {
    const todo = useQuery(getTodo, { id: context.todoId });
    const [dates, patchDates] = useAnnotation(due, context.todoId);
    const [settings, patchSettings] = useStore(prefs);

    const warnDays = settings?.warnDaysBefore ?? 2;
    const close = dates?.dueOn && daysUntil(dates.dueOn) <= warnDays;

    return (
      <Stack>
        <Text>{todo.data?.title}</Text>

        {/* A patch: only dueOn is written (D6). */}
        <DateInput label="Due" value={dates?.dueOn} onChange={(dueOn) => patchDates({ dueOn })} />
        {close && <Text tone="warning">Due soon</Text>}

        <NumberInput
          label="Warn me this many days before"
          value={warnDays}
          onChange={(warnDaysBefore) => patchSettings({ warnDaysBefore })}
        />
      </Stack>
    );
  },
);

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

import type { AgentEvent, AgentTurn, ModelAdapter } from "../../contract.js";

export interface ScriptedTurn {
  text?: string;
  toolCalls?: { name: string; input: unknown; id?: string }[];
}

/** A string is a turn that only says something. A function sees the turn the loop sends and answers it. */
export type ScriptedStep = string | ScriptedTurn | ((turn: AgentTurn) => string | ScriptedTurn);

export interface ScriptedModel extends ModelAdapter {
  /** Every turn the loop sent, in order. */
  turns: AgentTurn[];
}

/** A model adapter that replays a fixed list of turns, for tests. Running past the end of the list throws, so a loop
 * that does not stop shows up as a failure. */
export function scriptedModel(steps: ScriptedStep[]): ScriptedModel {
  let next = 0;
  let calls = 0;
  const adapter: ScriptedModel = {
    turns: [],
    async *run(turn): AsyncIterable<AgentEvent> {
      adapter.turns.push({ system: turn.system, messages: [...turn.messages], tools: turn.tools });
      if (next >= steps.length) throw new Error(`scriptedModel has no step ${next + 1}: the script ran out`);
      const step = steps[next++];
      const resolved = typeof step === "function" ? step(turn) : step;
      const scripted: ScriptedTurn = typeof resolved === "string" ? { text: resolved } : resolved;
      if (scripted.text) yield { type: "text", text: scripted.text };
      for (const call of scripted.toolCalls ?? []) yield { type: "tool", id: call.id ?? `call_${++calls}`, name: call.name, input: call.input };
      yield { type: "done" };
    },
  };
  return adapter;
}

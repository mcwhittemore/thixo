import type { EndpointDef, User } from "../contract.js";
import type { Schema } from "../schema/index.js";
import { BRAND, type Branded } from "./brand.js";

type InputOf<I> = I extends Schema<infer T> ? T : undefined;
type OutputOf<O> = O extends Schema<infer T> ? T : unknown;

export interface EndpointOptions<I extends Schema | undefined, O extends Schema | undefined> {
  method: EndpointDef["method"];
  /** Under `/api`, with `:param` segments, such as `/todos/:id`. A `:param` is filled into `input`. */
  path: string;
  /** The caller must hold every one (A3). */
  scopes: string[];
  /** Validated from the path, the query and the JSON body, in that order of precedence. */
  input?: I;
  output?: O;
  handler(call: { input: InputOf<I>; user: User; request: Request }): OutputOf<O> | Promise<OutputOf<O>>;
}

export interface EndpointHandle<I extends Schema | undefined = Schema | undefined, O extends Schema | undefined = Schema | undefined>
  extends Branded<"endpoint"> {
  readonly options: EndpointOptions<I, O>;
}

/** An endpoint of the app's API (A2). Its name is the name it is exported under from `api/`. */
export function endpoint<I extends Schema | undefined = undefined, O extends Schema | undefined = undefined>(
  options: EndpointOptions<I, O>,
): EndpointHandle<I, O> {
  if (!Array.isArray(options.scopes)) throw new Error(`endpoint ${options.method} ${options.path} needs scopes (A2)`);
  return { [BRAND]: "endpoint", options };
}

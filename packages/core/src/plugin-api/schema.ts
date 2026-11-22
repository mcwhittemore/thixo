/** `thixo/schema` as a plugin sees it: only the types a plugin data field can have (D3, D8). The app's own
 * `thixo/schema` has more, such as `t.object`, and is not importable from a plugin.
 *
 * Calls to `t` are allowed only at the top of a file, as the value of an exported `const`, with literal arguments
 * (U7): the build reads them without running them. */
export const SCHEMA_DTS = `// thixo/schema, for plugins.
//
// A field of plugin data is one of: t.string(), t.number(), t.boolean(), t.date(), t.url(),
// t.array(t.string()) or t.array(t.number()). Use them as the field types of annotate() and store() in data.thx.

/** The type of one field of plugin data. T is the type a plugin reads and writes. */
export interface FieldSchema<T> {
  readonly __thixoField: T;
}

export const t: {
  string(): FieldSchema<string>;
  number(): FieldSchema<number>;
  boolean(): FieldSchema<boolean>;
  /** A Date. */
  date(): FieldSchema<Date>;
  /** An address a plugin can pass along but never read or build. */
  url(): FieldSchema<Url>;
  /** A list of strings or of numbers. Nothing else can be a list item. */
  array(of: FieldSchema<string>): FieldSchema<string[]>;
  array(of: FieldSchema<number>): FieldSchema<number[]>;
};
`;

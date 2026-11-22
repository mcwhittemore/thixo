/** `thixo/data`: how a plugin declares the data it keeps (D1, D2). The compiler reads these calls as literals (U7),
 * so each must be the value of an exported const, at the top of a file, with literal arguments. */
export const DATA_DTS = `// thixo/data, for plugins.
//
//   import { annotate, store } from "thixo/data";
//   import { t } from "thixo/schema";
//   import { Todo } from "@app/sdk";
//
//   export const due = annotate(Todo, { dueOn: t.date() });
//   export const prefs = store("prefs", { fields: { warnDaysBefore: t.number() } });
//
// Pass the result to useAnnotation / useAnnotations or useStore / useStoreList from thixo/plugin to read and write.
// Every field is optional when read: a record nobody has written to has no fields (D5).

export {};

interface RecordHandle<Name extends string, Fields> {
  readonly __thixoRecord: Name;
  readonly __thixoRecordFields: Fields;
}

interface FieldSchema<T> {
  readonly __thixoField: T;
}

/** The fields of an annotation: the type of each one. The app's own record is unchanged (D2). */
interface AnnotationDecl<Fields> {
  readonly __thixoAnnotation: Fields;
}

/** The fields of a store: records the plugin owns, each belonging to one user. */
interface StoreDecl<Fields> {
  readonly __thixoStore: Fields;
}

type FieldValues<S> = { [K in keyof S]: S[K] extends FieldSchema<infer T> ? T : never };

/** Fields this plugin attaches to the app's records of one kind. Pass a record exported from @app/sdk. */
export function annotate<Name extends string, Fields, S extends { [field: string]: FieldSchema<unknown> }>(
  record: RecordHandle<Name, Fields>,
  fields: S,
): AnnotationDecl<FieldValues<S>>;

/** The plugin's own records, private to each user (D2). */
export function store<S extends { [field: string]: FieldSchema<unknown> }>(
  name: string,
  options: { fields: S },
): StoreDecl<FieldValues<S>>;
`;

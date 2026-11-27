// The tree the parser builds for a `.thx` file, a `.d.ts` file or emitted JavaScript. Positions are UTF-16 offsets
// into the file's text: `start` is where the node's first token begins, `end` is just past its last.

export interface Base {
  start: number;
  end: number;
  parent?: Node;
}

export interface SourceFile extends Base {
  kind: "SourceFile";
  /** Program path (`main.thx`), module specifier, or a name for the lib. */
  path: string;
  text: string;
  statements: Statement[];
  lineStarts: number[];
}

// ---- names ----

export interface Ident extends Base {
  kind: "Ident";
  name: string;
  /** True when the source spelled the name with a `\u` escape. */
  escaped: boolean;
}

export interface PrivateName extends Base {
  kind: "PrivateName";
  name: string;
}

export interface Computed extends Base {
  kind: "Computed";
  expr: Expr;
}

export type PropKey = Ident | Str | Num | Computed | PrivateName;

export interface Modifier extends Base {
  kind: "Modifier";
  name: string;
}

// ---- statements ----

export interface ImportSpec extends Base {
  kind: "ImportSpec";
  imported: Ident | Str;
  local: Ident;
  typeOnly: boolean;
  /** True when written `a as b`. */
  renamed: boolean;
}

export interface Import extends Base {
  kind: "Import";
  source: Str;
  typeOnly: boolean;
  defaultName?: Ident;
  namespace?: Ident;
  named?: ImportSpec[];
  attributes?: Base & { kind: "ImportAttributes" };
}

export interface ExportSpec extends Base {
  kind: "ExportSpec";
  local: Ident | Str;
  exported: Ident | Str;
  typeOnly: boolean;
}

export interface ExportNamed extends Base {
  kind: "ExportNamed";
  specs: ExportSpec[];
  source?: Str;
  typeOnly: boolean;
}

export interface ExportAll extends Base {
  kind: "ExportAll";
  source: Str;
}

export interface ExportDefault extends Base {
  kind: "ExportDefault";
  expr: Expr;
}

export interface ExportEquals extends Base {
  kind: "ExportEquals";
  expr: Expr;
}

export interface TypeParam extends Base {
  kind: "TypeParam";
  name: Ident;
  constraint?: TypeNode;
  default?: TypeNode;
  modifiers: Modifier[];
}

export interface Param extends Base {
  kind: "Param";
  target: Pattern;
  type?: TypeNode;
  init?: Expr;
  rest: boolean;
  optional: boolean;
  modifiers: Modifier[];
}

interface FunctionParts {
  name?: Ident;
  typeParams?: TypeParam[];
  params: Param[];
  returnType?: TypeNode;
  async: boolean;
  generator: boolean;
  modifiers: Modifier[];
}

export interface FunctionDecl extends Base, FunctionParts {
  kind: "FunctionDecl";
  body?: Block;
}

export interface VarDeclarator extends Base {
  kind: "VarDeclarator";
  target: Pattern;
  type?: TypeNode;
  init?: Expr;
  definite: boolean;
}

export interface VarDecl extends Base {
  kind: "VarDecl";
  declKind: "const" | "let" | "var" | "using";
  decls: VarDeclarator[];
  modifiers: Modifier[];
}

export interface TypeAlias extends Base {
  kind: "TypeAlias";
  name: Ident;
  typeParams?: TypeParam[];
  type: TypeNode;
  modifiers: Modifier[];
}

export interface Interface extends Base {
  kind: "Interface";
  name: Ident;
  typeParams?: TypeParam[];
  extends: TypeRef[];
  members: TypeMember[];
  modifiers: Modifier[];
}

/** `namespace X { ... }`, `module X {}` and `declare global {}`. The lib uses one, for `JSX`. */
export interface Namespace extends Base {
  kind: "Namespace";
  name: Ident;
  body: Statement[];
  modifiers: Modifier[];
}

export interface Block extends Base {
  kind: "Block";
  body: Statement[];
}

export interface Empty extends Base {
  kind: "Empty";
}

export interface ExprStmt extends Base {
  kind: "ExprStmt";
  expr: Expr;
}

export interface If extends Base {
  kind: "If";
  test: Expr;
  then: Statement;
  else?: Statement;
}

export interface While extends Base {
  kind: "While";
  test: Expr;
  body: Statement;
}

export interface DoWhile extends Base {
  kind: "DoWhile";
  body: Statement;
  test: Expr;
}

export interface For extends Base {
  kind: "For";
  init?: VarDecl | Expr;
  test?: Expr;
  update?: Expr;
  body: Statement;
}

export interface ForOf extends Base {
  kind: "ForOf";
  left: VarDecl | Expr;
  right: Expr;
  body: Statement;
  await: boolean;
}

export interface ForIn extends Base {
  kind: "ForIn";
  left: VarDecl | Expr;
  right: Expr;
  body: Statement;
}

export interface Return extends Base {
  kind: "Return";
  arg?: Expr;
}

export interface Jump extends Base {
  kind: "Break" | "Continue";
  label?: Ident;
}

export interface Throw extends Base {
  kind: "Throw";
  arg: Expr;
}

export interface Try extends Base {
  kind: "Try";
  block: Block;
  param?: Pattern;
  paramType?: TypeNode;
  handler?: Block;
  /** Where the `catch` keyword begins. */
  catchStart?: number;
  finalizer?: Block;
}

export interface SwitchCase extends Base {
  kind: "SwitchCase";
  test?: Expr;
  body: Statement[];
}

export interface Switch extends Base {
  kind: "Switch";
  disc: Expr;
  cases: SwitchCase[];
}

export interface Labeled extends Base {
  kind: "Labeled";
  label: Ident;
  body: Statement;
}

export interface With extends Base {
  kind: "With";
  object: Expr;
  body: Statement;
}

export interface Debugger extends Base {
  kind: "Debugger";
}

/** Syntax the parser reads only far enough to say it is not in the language: classes, enums, `import x =`. */
export interface Unsupported extends Base {
  kind: "Class" | "Enum" | "ImportEquals" | "Decorator";
}

export type Statement =
  | Import
  | ExportNamed
  | ExportAll
  | ExportDefault
  | ExportEquals
  | FunctionDecl
  | VarDecl
  | TypeAlias
  | Interface
  | Namespace
  | Block
  | Empty
  | ExprStmt
  | If
  | While
  | DoWhile
  | For
  | ForOf
  | ForIn
  | Return
  | Jump
  | Throw
  | Try
  | Switch
  | Labeled
  | With
  | Debugger
  | Unsupported;

// ---- expressions ----

export interface Num extends Base {
  kind: "Num";
  value: number;
  raw: string;
}

export interface Str extends Base {
  kind: "Str";
  value: string;
  raw: string;
}

export interface Bool extends Base {
  kind: "Bool";
  value: boolean;
}

export interface Null extends Base {
  kind: "Null";
}

export interface TemplateQuasi {
  cooked: string;
  raw: string;
}

export interface Template extends Base {
  kind: "Template";
  quasis: TemplateQuasi[];
  exprs: Expr[];
}

export interface TaggedTemplate extends Base {
  kind: "TaggedTemplate";
  tag: Expr;
  quasi: Template;
}

export interface Keyword extends Base {
  kind: "This" | "Super" | "Regex" | "BigInt" | "ImportMeta" | "NewTarget" | "ClassExpr";
}

export interface Spread extends Base {
  kind: "Spread";
  arg: Expr;
}

export interface Hole extends Base {
  kind: "Hole";
}

export interface ArrayLit extends Base {
  kind: "Array";
  elements: (Expr | Spread | Hole)[];
}

export interface Prop extends Base {
  kind: "Prop";
  key: PropKey;
  value: Expr;
}

export interface Shorthand extends Base {
  kind: "Shorthand";
  name: Ident;
  /** `{ a = 1 }`, which is only valid as a destructuring target. */
  init?: Expr;
}

export interface Method extends Base, FunctionParts {
  kind: "Method";
  key: PropKey;
  optional: boolean;
  body?: Block;
}

export interface Accessor extends Base {
  kind: "Getter" | "Setter";
  key: PropKey;
}

export interface ObjectLit extends Base {
  kind: "Object";
  props: (Prop | Shorthand | Spread | Method | Accessor)[];
}

export interface FunctionExpr extends Base, FunctionParts {
  kind: "Function";
  body: Block;
}

export interface Arrow extends Base, FunctionParts {
  kind: "Arrow";
  body: Block | Expr;
}

export interface Unary extends Base {
  kind: "Unary";
  op: "!" | "-" | "+" | "~" | "typeof" | "void" | "delete";
  arg: Expr;
}

export interface Update extends Base {
  kind: "Update";
  op: "++" | "--";
  prefix: boolean;
  arg: Expr;
}

export interface Binary extends Base {
  kind: "Binary";
  op: string;
  /** Where the operator token begins. */
  opStart: number;
  left: Expr;
  right: Expr;
}

export interface Assign extends Base {
  kind: "Assign";
  op: string;
  left: Expr;
  right: Expr;
}

export interface Cond extends Base {
  kind: "Cond";
  test: Expr;
  cons: Expr;
  alt: Expr;
}

/** A link in an optional chain (`a?.b.c`): `optional` is this link's own `?.`, `inChain` is true for every link
 * from the first `?.` to the end of the chain. */
interface ChainParts {
  optional: boolean;
  inChain: boolean;
}

export interface Call extends Base, ChainParts {
  kind: "Call";
  callee: Expr;
  typeArgs?: TypeNode[];
  args: (Expr | Spread)[];
}

export interface New extends Base {
  kind: "New";
  callee: Expr;
  typeArgs?: TypeNode[];
  args?: (Expr | Spread)[];
}

export interface Member extends Base, ChainParts {
  kind: "Member";
  object: Expr;
  prop: Ident | PrivateName;
}

export interface Index extends Base, ChainParts {
  kind: "Index";
  object: Expr;
  index: Expr;
}

export interface Paren extends Base {
  kind: "Paren";
  expr: Expr;
}

export interface Await extends Base {
  kind: "Await";
  arg: Expr;
}

export interface Yield extends Base {
  kind: "Yield";
  arg?: Expr;
}

export interface As extends Base {
  kind: "As" | "Satisfies";
  expr: Expr;
  type: TypeNode;
}

export interface NonNull extends Base {
  kind: "NonNull";
  expr: Expr;
}

export interface ImportCall extends Base {
  kind: "ImportCall";
  args: Expr[];
}

// ---- JSX ----

export interface JsxNamespacedName extends Base {
  kind: "JsxNamespacedName";
  namespace: Ident;
  name: Ident;
}

export interface JsxMemberName extends Base {
  kind: "JsxMemberName";
  object: Ident | JsxMemberName;
  prop: Ident;
}

export type JsxTagName = Ident | JsxNamespacedName | JsxMemberName;

export interface JsxExprContainer extends Base {
  kind: "JsxExprContainer";
  expr?: Expr;
  spread: boolean;
}

export interface JsxAttr extends Base {
  kind: "JsxAttr";
  name: Ident | JsxNamespacedName;
  /** A string value is the raw text between the quotes: JSX has no escapes in attribute strings. */
  value?: Str | JsxExprContainer | JsxElement | JsxFragment;
}

export interface JsxSpreadAttr extends Base {
  kind: "JsxSpreadAttr";
  arg: Expr;
}

export interface JsxText extends Base {
  kind: "JsxText";
  raw: string;
}

export type JsxChild = JsxText | JsxExprContainer | JsxElement | JsxFragment;

export interface JsxElement extends Base {
  kind: "JsxElement";
  name: JsxTagName;
  typeArgs?: TypeNode[];
  attrs: (JsxAttr | JsxSpreadAttr)[];
  /** Undefined for a self-closing element. */
  children?: JsxChild[];
}

export interface JsxFragment extends Base {
  kind: "JsxFragment";
  children: JsxChild[];
}

export type Expr =
  | Ident
  | Num
  | Str
  | Bool
  | Null
  | Template
  | TaggedTemplate
  | Keyword
  | ArrayLit
  | ObjectLit
  | FunctionExpr
  | Arrow
  | Unary
  | Update
  | Binary
  | Assign
  | Cond
  | Call
  | New
  | Member
  | Index
  | Paren
  | Await
  | Yield
  | As
  | NonNull
  | ImportCall
  | JsxElement
  | JsxFragment
  | PrivateName;

// ---- patterns ----

export interface BindingElement extends Base {
  kind: "BindingElement";
  /** The field read, in an object pattern. Undefined in a list pattern and for `{ a }`. */
  key?: PropKey;
  target: Pattern;
  init?: Expr;
  rest: boolean;
}

export interface ObjectPattern extends Base {
  kind: "ObjectPattern";
  elements: BindingElement[];
}

export interface ArrayPattern extends Base {
  kind: "ArrayPattern";
  elements: (BindingElement | Hole)[];
}

export type Pattern = Ident | ObjectPattern | ArrayPattern;

// ---- types ----

export interface QualifiedName extends Base {
  kind: "QualifiedName";
  left: Ident | QualifiedName;
  right: Ident;
}

export interface TypeRef extends Base {
  kind: "TypeRef";
  name: Ident | QualifiedName;
  args?: TypeNode[];
}

export interface KeywordType extends Base {
  kind: "KeywordType";
  name: "string" | "number" | "boolean" | "unknown" | "never" | "void" | "undefined" | "null" | "object" | "any" | "symbol" | "bigint" | "this";
}

export interface LiteralType extends Base {
  kind: "LiteralType";
  value: string | number | boolean;
}

export interface TemplateType extends Base {
  kind: "TemplateType";
  quasis: string[];
  types: TypeNode[];
}

export interface ArrayType extends Base {
  kind: "ArrayType";
  elem: TypeNode;
}

export interface TupleElement extends Base {
  kind: "TupleElement";
  name?: Ident;
  type: TypeNode;
  optional: boolean;
  rest: boolean;
}

export interface TupleType extends Base {
  kind: "TupleType";
  elements: TupleElement[];
}

export interface UnionType extends Base {
  kind: "UnionType" | "IntersectionType";
  types: TypeNode[];
}

export interface FunctionType extends Base {
  kind: "FunctionType" | "ConstructorType";
  typeParams?: TypeParam[];
  params: Param[];
  returnType: TypeNode;
}

export interface TypeLiteral extends Base {
  kind: "TypeLiteral";
  members: TypeMember[];
}

export interface ParenType extends Base {
  kind: "ParenType";
  type: TypeNode;
}

export interface TypeQuery extends Base {
  kind: "TypeQuery";
  name: Ident | QualifiedName;
}

export interface TypeOperator extends Base {
  kind: "TypeOperator";
  op: "keyof" | "readonly" | "unique";
  type: TypeNode;
}

export interface IndexedAccessType extends Base {
  kind: "IndexedAccessType";
  object: TypeNode;
  index: TypeNode;
}

export interface TypePredicate extends Base {
  kind: "TypePredicate";
  param: Ident | KeywordType;
  type?: TypeNode;
  asserts: boolean;
}

/** Types the checker refuses: conditional, mapped, `infer`, `import(...)`. The parser keeps their parts so the lib
 * still reads, and the checker replaces a few lib names that use them with its own. */
export interface ConditionalType extends Base {
  kind: "ConditionalType";
  check: TypeNode;
  extendsType: TypeNode;
  trueType: TypeNode;
  falseType: TypeNode;
}

export interface MappedType extends Base {
  kind: "MappedType";
  param: Ident;
  constraint: TypeNode;
  type?: TypeNode;
}

export interface InferType extends Base {
  kind: "InferType";
  name: Ident;
}

export interface ImportType extends Base {
  kind: "ImportType";
}

export type TypeNode =
  | TypeRef
  | KeywordType
  | LiteralType
  | TemplateType
  | ArrayType
  | TupleType
  | UnionType
  | FunctionType
  | TypeLiteral
  | ParenType
  | TypeQuery
  | TypeOperator
  | IndexedAccessType
  | TypePredicate
  | ConditionalType
  | MappedType
  | InferType
  | ImportType;

export interface PropSig extends Base {
  kind: "PropSig";
  key: PropKey;
  optional: boolean;
  readonly: boolean;
  type?: TypeNode;
}

export interface MethodSig extends Base {
  kind: "MethodSig";
  key: PropKey;
  optional: boolean;
  typeParams?: TypeParam[];
  params: Param[];
  returnType?: TypeNode;
}

export interface CallSig extends Base {
  kind: "CallSig" | "ConstructSig";
  typeParams?: TypeParam[];
  params: Param[];
  returnType?: TypeNode;
}

export interface IndexSig extends Base {
  kind: "IndexSig";
  param: Ident;
  keyType: TypeNode;
  type: TypeNode;
  readonly: boolean;
}

export type TypeMember = PropSig | MethodSig | CallSig | IndexSig;

export type Node =
  | SourceFile
  | Statement
  | Expr
  | TypeNode
  | TypeMember
  | Pattern
  | BindingElement
  | Param
  | TypeParam
  | VarDeclarator
  | ImportSpec
  | ExportSpec
  | SwitchCase
  | Prop
  | Shorthand
  | Method
  | Accessor
  | Spread
  | Hole
  | Computed
  | Modifier
  | QualifiedName
  | TupleElement
  | JsxAttr
  | JsxSpreadAttr
  | JsxText
  | JsxExprContainer
  | JsxNamespacedName
  | JsxMemberName;

export type FunctionLike = FunctionDecl | FunctionExpr | Arrow | Method;

export function isFunctionLike(n: Node): n is FunctionLike {
  return n.kind === "FunctionDecl" || n.kind === "Function" || n.kind === "Arrow" || n.kind === "Method";
}

/** Calls `fn` on each child node, in source order. */
export function forEachChild(node: Node, fn: (child: Node) => void): void {
  for (const key in node) {
    if (key === "parent") continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v === "object" && "kind" in v) fn(v as Node);
    } else if (value && typeof value === "object" && "kind" in (value as object)) fn(value as Node);
  }
}

export function setParents(root: Node): void {
  const visit = (n: Node) =>
    forEachChild(n, (c) => {
      c.parent = n;
      visit(c);
    });
  visit(root);
}

/** 1-based line and column of an offset. */
export function lineCol(sf: SourceFile, pos: number): { line: number; column: number } {
  let lo = 0;
  let hi = sf.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sf.lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: pos - sf.lineStarts[lo] + 1 };
}

export function sourceFileOf(n: Node): SourceFile {
  let x: Node | undefined = n;
  while (x && x.kind !== "SourceFile") x = x.parent;
  if (!x) throw new Error("node outside a file");
  return x;
}

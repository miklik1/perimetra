/**
 * The Expr DSL — the entire programmability surface of a product model
 * (CORE_SPEC §3). Expressions are authored and stored as plain strings inside
 * a {@link ProductModelRelease}; the engine parses them once and evaluates them
 * against a flat, dotted-key scope.
 *
 * Design contract (CORE_SPEC I1 — determinism):
 *   - No clock, no randomness, no I/O. `evaluate` is a pure function of
 *     `(ast, scope)`. The only non-arithmetic primitive is `sinDeg`, which is
 *     IEEE-754 `Math.sin` — deterministic and portable, so equal inputs give
 *     byte-identical outputs on any conformant engine.
 *   - The function set is a closed whitelist. A model that needs more does not
 *     get an escape hatch; the engine grows a new whitelisted function.
 *
 * Grammar (precedence low→high):
 *   ||  →  &&  →  == !=  →  < <= > >=  →  + -  →  * / %  →  unary - !  →  primary
 *   primary: number | string | true | false | ref | call(args…) | ( expr )
 *   ref:  dotted identifier, e.g. `opening_width_mm`, `fill.min_spacing_mm`.
 */

/** A serialized expression as stored in a release. Branded so a raw string is
 *  not silently accepted where an authored expression is expected. */
export type ExprString = string & { readonly __expr: unique symbol };

/** Convenience constructor for authoring releases in TS. */
export const expr = (source: string): ExprString => source as ExprString;

export type Value = number | string | boolean;

/** A flat scope: refs resolve by exact dotted-key lookup (e.g. `"fill.profile_mm"`). */
export type Scope = Record<string, Value>;

// --- AST ---------------------------------------------------------------------

export type Ast =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; path: string }
  | { k: "unary"; op: "-" | "!"; x: Ast }
  | { k: "bin"; op: BinOp; a: Ast; b: Ast }
  | { k: "call"; fn: string; args: Ast[] };

type BinOp = "||" | "&&" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";

/** Raised for any malformed or ill-typed expression — surfaced as an I5 hard
 *  error by the engine, never swallowed into a silent 0/NaN. */
export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

// --- Tokenizer ---------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "punc"; v: "(" | ")" | "," };

const OPERATORS = ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!"];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdPart = (c: string) => /[A-Za-z0-9_.]/.test(c);

  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') {
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new ExprError(`Unterminated string in: ${src}`);
      tokens.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (Number.isNaN(v)) throw new ExprError(`Bad number "${raw}" in: ${src}`);
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < src.length && isIdPart(src[j]!)) j++;
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      tokens.push({ t: "punc", v: c });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    const op =
      OPERATORS.find((o) => o.length === 2 && o === two) ??
      OPERATORS.find((o) => o.length === 1 && o === c);
    if (op) {
      tokens.push({ t: "op", v: op });
      i += op.length;
      continue;
    }
    throw new ExprError(`Unexpected character "${c}" in: ${src}`);
  }
  return tokens;
}

// --- Parser (recursive descent by precedence) --------------------------------

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  parse(): Ast {
    const ast = this.expr(0);
    if (this.pos < this.tokens.length) {
      throw new ExprError(`Unexpected trailing token in: ${this.src}`);
    }
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(minPrec: number): Ast {
    let left = this.unary();
    while (true) {
      const tok = this.peek();
      if (!tok || tok.t !== "op") break;
      const prec = PRECEDENCE[tok.v];
      if (prec === undefined || prec < minPrec) break;
      this.pos++;
      const right = this.expr(prec + 1); // left-associative
      left = { k: "bin", op: tok.v as BinOp, a: left, b: right };
    }
    return left;
  }

  private unary(): Ast {
    const tok = this.peek();
    if (tok?.t === "op" && (tok.v === "-" || tok.v === "!")) {
      this.pos++;
      return { k: "unary", op: tok.v, x: this.unary() };
    }
    return this.primary();
  }

  private primary(): Ast {
    const tok = this.peek();
    if (!tok) throw new ExprError(`Unexpected end of expression: ${this.src}`);

    if (tok.t === "num") {
      this.pos++;
      return { k: "num", v: tok.v };
    }
    if (tok.t === "str") {
      this.pos++;
      return { k: "str", v: tok.v };
    }
    if (tok.t === "punc" && tok.v === "(") {
      this.pos++;
      const inner = this.expr(0);
      this.expectPunc(")");
      return inner;
    }
    if (tok.t === "id") {
      this.pos++;
      if (tok.v === "true") return { k: "bool", v: true };
      if (tok.v === "false") return { k: "bool", v: false };
      // function call?
      const next = this.peek();
      if (next?.t === "punc" && next.v === "(") {
        this.pos++;
        const args: Ast[] = [];
        if (!(this.peek()?.t === "punc" && (this.peek() as { v: string }).v === ")")) {
          args.push(this.expr(0));
          while (this.peek()?.t === "punc" && (this.peek() as { v: string }).v === ",") {
            this.pos++;
            args.push(this.expr(0));
          }
        }
        this.expectPunc(")");
        return { k: "call", fn: tok.v, args };
      }
      return { k: "ref", path: tok.v };
    }
    throw new ExprError(`Unexpected token "${JSON.stringify(tok)}" in: ${this.src}`);
  }

  private expectPunc(v: string): void {
    const tok = this.peek();
    if (!(tok?.t === "punc" && tok.v === v)) {
      throw new ExprError(`Expected "${v}" in: ${this.src}`);
    }
    this.pos++;
  }
}

/** Parse a stored expression string into an AST (cache the result per release). */
export function parse(source: ExprString | string): Ast {
  return new Parser(tokenize(source), source).parse();
}

// --- Evaluator ---------------------------------------------------------------

function asNumber(v: Value, ctx: string): number {
  if (typeof v !== "number") throw new ExprError(`Expected number ${ctx}, got ${typeof v}`);
  return v;
}
function asBool(v: Value, ctx: string): boolean {
  if (typeof v !== "boolean") throw new ExprError(`Expected boolean ${ctx}, got ${typeof v}`);
  return v;
}

type Fn = (args: Value[], raw: Ast[]) => Value;

const FUNCTIONS: Record<string, Fn> = {
  min: (a) => Math.min(...a.map((v) => asNumber(v, "in min()"))),
  max: (a) => Math.max(...a.map((v) => asNumber(v, "in max()"))),
  abs: (a) => Math.abs(asNumber(a[0]!, "in abs()")),
  floor: (a) => Math.floor(asNumber(a[0]!, "in floor()")),
  ceil: (a) => Math.ceil(asNumber(a[0]!, "in ceil()")),
  round: (a) => Math.round(asNumber(a[0]!, "in round()")),
  roundUp: (a) => Math.ceil(asNumber(a[0]!, "in roundUp()")),
  roundTo: (a) => {
    const x = asNumber(a[0]!, "in roundTo()");
    const step = asNumber(a[1]!, "in roundTo()");
    if (step === 0) throw new ExprError("roundTo() step must be non-zero");
    return Math.round(x / step) * step;
  },
  clamp: (a) => {
    const x = asNumber(a[0]!, "in clamp()");
    const lo = asNumber(a[1]!, "in clamp()");
    const hi = asNumber(a[2]!, "in clamp()");
    return Math.min(Math.max(x, lo), hi);
  },
  // Degrees in, deterministic IEEE-754 — mirrors the MVP's Math.sin((deg*PI)/180).
  sinDeg: (a) => Math.sin((asNumber(a[0]!, "in sinDeg()") * Math.PI) / 180),
  // if() is lazy: only the taken branch is evaluated (handled specially below).
};

const LAZY = new Set(["if"]);

export function evaluate(ast: Ast, scope: Scope): Value {
  switch (ast.k) {
    case "num":
      return ast.v;
    case "str":
      return ast.v;
    case "bool":
      return ast.v;
    case "ref": {
      const v = scope[ast.path];
      if (v === undefined) {
        throw new ExprError(`Unknown reference "${ast.path}"`);
      }
      return v;
    }
    case "unary": {
      if (ast.op === "-") return -asNumber(evaluate(ast.x, scope), "after unary -");
      return !asBool(evaluate(ast.x, scope), "after unary !");
    }
    case "call": {
      if (LAZY.has(ast.fn)) {
        if (ast.fn === "if") {
          if (ast.args.length !== 3) throw new ExprError("if() takes exactly 3 args");
          const cond = asBool(evaluate(ast.args[0]!, scope), "in if() condition");
          return evaluate(cond ? ast.args[1]! : ast.args[2]!, scope);
        }
      }
      const fn = FUNCTIONS[ast.fn];
      if (!fn) throw new ExprError(`Unknown function "${ast.fn}()"`);
      return fn(
        ast.args.map((a) => evaluate(a, scope)),
        ast.args,
      );
    }
    case "bin":
      return evalBin(ast, scope);
  }
}

function evalBin(ast: { op: BinOp; a: Ast; b: Ast }, scope: Scope): Value {
  // Short-circuit logical operators.
  if (ast.op === "&&") {
    return (
      asBool(evaluate(ast.a, scope), "left of &&") && asBool(evaluate(ast.b, scope), "right of &&")
    );
  }
  if (ast.op === "||") {
    return (
      asBool(evaluate(ast.a, scope), "left of ||") || asBool(evaluate(ast.b, scope), "right of ||")
    );
  }

  const a = evaluate(ast.a, scope);
  const b = evaluate(ast.b, scope);

  if (ast.op === "==") return a === b;
  if (ast.op === "!=") return a !== b;

  // Remaining operators are numeric.
  const x = asNumber(a, `left of ${ast.op}`);
  const y = asNumber(b, `right of ${ast.op}`);
  switch (ast.op) {
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      if (y === 0) throw new ExprError("Division by zero");
      return x / y;
    case "%":
      return x % y;
  }
}

/** Parse + evaluate in one step (convenience; the engine caches parsed ASTs). */
export function evalString(source: ExprString | string, scope: Scope): Value {
  return evaluate(parse(source), scope);
}

export function evalNumber(source: ExprString | string, scope: Scope): number {
  return asNumber(evalString(source, scope), `evaluating "${source}"`);
}

export function evalBoolean(source: ExprString | string, scope: Scope): boolean {
  return asBool(evalString(source, scope), `evaluating "${source}"`);
}

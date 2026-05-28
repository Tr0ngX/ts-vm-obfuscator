# AST Support Matrix

This document tracks IR lowering coverage for virtualized regions in TSXobf.

## Supported

### Expressions

- Literals: number, string, template-free string, `null`, `true`, `false`
- Wrappers: parenthesized expressions, `as`, non-null assertions, `satisfies`, angle-bracket type assertions
- Identifiers
- Binary arithmetic/comparison operators covered in `packages/ir/src/builder.ts`
- Conditional expressions: `cond ? a : b`
- Logical short-circuit: `&&`, `||`, `??` (Exhaustively verified in compound logical conditional expressions with bitwise masks)
- Property access and element access (Exhaustively verified for dynamic keys `obj[key]`, nested properties, and array indices `arr[idx]`)
- Array literals
- Iterable spread elements in array literals, call arguments, and `new` arguments
- Sparse array holes in array literals
- Object literals with property assignments, shorthand properties, object-literal methods, and computed names (all property forms fully covered)
- Calls and `new`
- `this` and `new.target` for regular function and constructor-style lowering
- lexical `this` and lexical `new.target` in nested arrows with an enclosing function context
- base `class` declarations and `class` expressions, constructor, methods, accessors, public/private instance fields, static fields, and computed names
- Nested `FunctionExpression`, `ArrowFunction`, local `FunctionDeclaration`, and object-literal `MethodDeclaration`
- `await` inside verified async function declarations and async arrows
- Prefix unary subset: `!`, unary `-`, `~`, `typeof`
- Postfix unary expressions: `++` and `--` for identifiers (Exhaustively verified for loop index counters like `idx++`)
- `delete` operator (Exhaustively verified on dynamically assigned keys and nested object properties)
- Private class fields (`#field`)
- Synchronous and async generators with `yield` and `yield*` expressions

### Statements

- Blocks
- Variable statements
- Local function declarations
- Expression statements
- Return
- `if / else`
- `for`
- `while`
- `do / while`
- `break`
- `continue`
- `switch`
- `throw`
- `try / catch / finally` with synchronous execution, including destructured catch bindings
- `for...of`
- `for...in`
- object and array destructuring declarations, including simple default values
- destructuring assignments for verified array/object forms, including simple nesting and default values
- object and array rest binding in declarations, assignments, loop bindings, and catch bindings
- **computed key destructuring** in object binding patterns and object assignment destructuring (Exhaustively verified via `verifyArtemisComputedDestructuring` in E2E pipeline)
- rest parameters and parameter destructuring
- spread in array/object literals and call/new arguments
- async function declarations and async arrows with verified `await` usage
- **`for await...of`** loops over async iterables (Exhaustively verified via `verifyArtemisAsyncLoop` in E2E pipeline; resolves `Symbol.asyncIterator` and injects `OpCode.Await` per iteration step)

### Closures

- Capturing outer locals through cell boxing and closure environments
- Mutating captured locals across function boundaries

## Supported With Limits

- Captured bindings incur targeted boxing overhead
- Derived classes (`extends` / `super`) are outside the verified VM path
- Class static blocks (`static {}`) are not yet lowered

## Unsupported / Planned

### Expressions

### Language Features

- Decorators
- Derived classes (`extends` / `super`)
- Private class methods and accessors
- Class static blocks (`static {}`)

## Expansion Rule

New syntax support should land as a syntax pack:

1. Add or update fixture coverage for the syntax family.
2. Add IR-lowering tests.
3. Add runtime execution tests when VM semantics are involved.
4. Update this matrix in the same change.

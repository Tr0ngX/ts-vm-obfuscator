# AST Support Matrix

This document tracks IR lowering coverage for virtualized regions in TSXobf.

## Supported

### Expressions

- Literals: number, string, template-free string, `null`, `true`, `false`
- Wrappers: parenthesized expressions, `as`, non-null assertions, `satisfies`, angle-bracket type assertions
- Identifiers
- Binary arithmetic/comparison operators covered in `packages/ir/src/builder.ts`
- Conditional expressions: `cond ? a : b`
- Logical short-circuit: `&&`, `||`, `??`
- Property access and element access
- Array literals
- Iterable spread elements in array literals, call arguments, and `new` arguments
- Sparse array holes in array literals
- Object literals with property assignments, shorthand properties, and object-literal methods
- Calls and `new`
- `this` and `new.target` for regular function and constructor-style lowering
- lexical `this` and lexical `new.target` in nested arrows with an enclosing function context
- base and derived `class` declarations and `class` expressions (including `extends`/`super`), constructor, methods, accessors, public/private fields, static blocks, static fields, and computed names
- Nested `FunctionExpression`, `ArrowFunction`, local `FunctionDeclaration`, and object-literal `MethodDeclaration`
- `await` inside verified async function declarations and async arrows
- Prefix unary subset: `!`, unary `-`, `~`, `typeof`
- `delete`
- `super` property/element access and `super` constructor calls
- Private class fields and methods (`#field`)
- Class static blocks (`static {}`)
- Synchronous generators with `yield` and `yield*` expressions

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
- rest parameters and parameter destructuring
- spread in array/object literals and call/new arguments
- async function declarations and async arrows with verified `await` usage

### Closures

- Capturing outer locals through cell boxing and closure environments
- Mutating captured locals across function boundaries

## Supported With Limits

- Captured bindings incur targeted boxing overhead
- Lexical `this` and lexical `new.target` are only verified for nested arrows with an enclosing function context; top-level arrows without a lexical provider stay off the VM-safe path
- Object literals do not yet cover every property form
- Async support is currently limited to verified `await` patterns (async generators are not supported)

## Unsupported / Planned

### Expressions

### Language Features

- Decorators

## Expansion Rule

New syntax support should land as a syntax pack:

1. Add or update fixture coverage for the syntax family.
2. Add IR-lowering tests.
3. Add runtime execution tests when VM semantics are involved.
4. Update this matrix in the same change.

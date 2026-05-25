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
- Object literals with property assignments, shorthand properties, and object-literal methods
- Calls and `new`
- Nested `FunctionExpression`, `ArrowFunction`, local `FunctionDeclaration`, and object-literal `MethodDeclaration`
- Prefix unary subset: `!`, unary `-`, `~`, `typeof`
- `delete`

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

### Closures

- Capturing outer locals through cell boxing and closure environments
- Mutating captured locals across function boundaries

## Supported With Limits

- Captured bindings incur targeted boxing overhead
- `this` is not fully modeled yet and should not be treated as verified runtime support
- Object literals do not yet cover every property form

## Unsupported / Planned

### Expressions

- Spread elements and sparse array holes
- `super`
- Class expressions
- `await`
- `yield`

### Language Features

- Classes
- Async / await
- Generators
- Decorators

## Expansion Rule

New syntax support should land as a syntax pack:

1. Add or update fixture coverage for the syntax family.
2. Add IR-lowering tests.
3. Add runtime execution tests when VM semantics are involved.
4. Update this matrix in the same change.

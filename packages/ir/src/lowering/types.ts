import ts from 'typescript';
import type { Diagnostic, Register } from '@tsvm/shared';

export type SupportedFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

export interface LowerToIROptions {
  readonly forceVirtualizeAll?: boolean;
  readonly forceVirtualizeFunctionNames?: ReadonlySet<string>;
  readonly skipTopLevelFunctionNames?: ReadonlySet<string>;
  readonly compatibilityFallback?: boolean;
  readonly diagnostics?: Diagnostic[];
}

export interface ClosureAnalysis {
  readonly localNames: ReadonlySet<string>;
  readonly capturedFromOuter: readonly string[];
  readonly capturedByDescendants: ReadonlySet<string>;
}

export interface LocalBinding {
  readonly register: Register;
  readonly boxed: boolean;
}

export interface PendingParameterBinding {
  readonly param: ts.ParameterDeclaration;
  readonly register: Register;
}

export type CompletionKind = 0 | 1 | 2 | 3 | 4;

export interface FinallyCompletionTarget {
  readonly code: number;
  readonly kind: 'break' | 'continue';
  readonly blockId: string;
}

export interface FinallyContext {
  readonly finallyBlockId: string;
  readonly completionKindLocal: Register;
  readonly completionValueLocal: Register;
  readonly completionTargetLocal: Register;
  readonly targets: FinallyCompletionTarget[];
}

export interface NormalizedComputedName {
  readonly bindingName: string;
  readonly expression: ts.Expression;
}

export interface NormalizedClassMethodElement {
  readonly kind: 'constructor' | 'method' | 'getter' | 'setter';
  readonly node: ts.ConstructorDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
  readonly isStatic: boolean;
  readonly keyName?: string;
  readonly computedBindingName?: string;
}

export interface NormalizedClassFieldElement {
  readonly kind: 'field';
  readonly node: ts.PropertyDeclaration;
  readonly isStatic: boolean;
  readonly keyName?: string;
  readonly computedBindingName?: string;
  readonly privateBindingName?: string;
}

export interface NormalizedClassStaticBlockElement {
  readonly kind: 'static_block';
  readonly node: ts.ClassStaticBlockDeclaration;
  readonly isStatic: true;
}

export type NormalizedClassElement = NormalizedClassMethodElement | NormalizedClassFieldElement | NormalizedClassStaticBlockElement;

export interface NormalizedClass {
  readonly bindingName?: string;
  readonly restoreBinding?: LocalBinding;
  readonly constructorElement?: NormalizedClassMethodElement;
  readonly computedNames: readonly NormalizedComputedName[];
  readonly privateIdentifiers: ReadonlyMap<string, string>;
  readonly instanceElements: readonly NormalizedClassElement[];
  readonly staticElements: readonly NormalizedClassElement[];
  readonly extendsExpression?: ts.Expression;
}

export const LEXICAL_THIS_CAPTURE = '$$vm_lexical_this';
export const LEXICAL_NEW_TARGET_CAPTURE = '$$vm_lexical_new_target';

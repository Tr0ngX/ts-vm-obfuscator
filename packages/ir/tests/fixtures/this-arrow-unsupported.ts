export const topLevelLexicalThisArrow = () => {
  return this;
};

export const topLevelLexicalNewTargetArrow = () => {
  return new.target;
};

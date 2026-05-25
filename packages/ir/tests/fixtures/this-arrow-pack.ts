export const lexicalThisArrow = () => {
  return this;
};

export const lexicalNewTargetArrow = () => {
  return new.target;
};

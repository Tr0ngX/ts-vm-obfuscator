export function classExtendsPack() {
  class Base {
    value = 1;
  }

  class Derived extends Base {
    value = 2;
  }

  return new Derived().value;
}

export function classPrivatePack() {
  class WithPrivate {
    #value = 1;

    read() {
      return this.#value;
    }
  }

  return new WithPrivate().read();
}

export function classStaticBlockPack() {
  class WithStaticBlock {
    static value = 1;

    static {
      this.value += 1;
    }
  }

  return WithStaticBlock.value;
}

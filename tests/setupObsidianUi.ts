import '@testing-library/jest-dom';

Object.defineProperties(globalThis, {
  activeDocument: { configurable: true, value: document },
  activeWindow: { configurable: true, value: window },
});

Object.defineProperties(Node.prototype, {
  instanceOf: {
    configurable: true,
    value(this: Node, constructor: typeof Node) {
      return this instanceof constructor;
    },
  },
});

Object.defineProperties(HTMLElement.prototype, {
  addClass: {
    configurable: true,
    value(this: HTMLElement, ...classes: string[]) {
      this.classList.add(...classes);
    },
  },
  appendText: {
    configurable: true,
    value(this: HTMLElement, text: string) {
      this.append(text);
    },
  },
  createDiv: {
    configurable: true,
    value(this: HTMLElement, options: { cls?: string | string[]; attr?: Record<string, string> } = {}) {
      const div = this.ownerDocument.createElement('div');
      const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(/\s+/);
      if (classes) div.classList.add(...classes.filter(Boolean));
      for (const [name, value] of Object.entries(options.attr ?? {})) div.setAttribute(name, value);
      this.appendChild(div);
      return div;
    },
  },
  empty: {
    configurable: true,
    value(this: HTMLElement) {
      this.replaceChildren();
    },
  },
  toggleClass: {
    configurable: true,
    value(this: HTMLElement, className: string, force?: boolean) {
      this.classList.toggle(className, force);
    },
  },
});

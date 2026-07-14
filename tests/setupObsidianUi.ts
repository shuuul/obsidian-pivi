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
    value(this: HTMLElement, options: { cls?: string | string[]; attr?: Record<string, string>; text?: string | DocumentFragment } = {}) {
      const div = this.ownerDocument.createElement('div');
      const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(/\s+/);
      if (classes) div.classList.add(...classes.filter(Boolean));
      for (const [name, value] of Object.entries(options.attr ?? {})) div.setAttribute(name, value);
      if (typeof options.text === 'string') div.textContent = options.text;
      else if (options.text) div.appendChild(options.text);
      this.appendChild(div);
      return div;
    },
  },
  createSpan: {
    configurable: true,
    value(this: HTMLElement, options: { cls?: string | string[]; text?: string } = {}) {
      const span = this.ownerDocument.createElement('span');
      const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(/\s+/);
      if (classes) span.classList.add(...classes.filter(Boolean));
      if (options.text) span.textContent = options.text;
      this.appendChild(span);
      return span;
    },
  },
  empty: {
    configurable: true,
    value(this: HTMLElement) {
      this.replaceChildren();
    },
  },
  hasClass: {
    configurable: true,
    value(this: HTMLElement, className: string) {
      return this.classList.contains(className);
    },
  },
  removeClass: {
    configurable: true,
    value(this: HTMLElement, ...classes: string[]) {
      this.classList.remove(...classes);
    },
  },
  setText: {
    configurable: true,
    value(this: HTMLElement, text: string) {
      this.textContent = text;
    },
  },
  setCssProps: {
    configurable: true,
    value(this: HTMLElement, properties: Record<string, string>) {
      for (const [name, value] of Object.entries(properties)) {
        this.style.setProperty(name, value);
      }
    },
  },
  toggleClass: {
    configurable: true,
    value(this: HTMLElement, className: string, force?: boolean) {
      this.classList.toggle(className, force);
    },
  },
});

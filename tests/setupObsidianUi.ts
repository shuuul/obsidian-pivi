import '@testing-library/jest-dom';

interface TestDomElementInfo {
  attr?: Record<string, string | number | boolean | null>;
  cls?: string | string[];
  href?: string;
  parent?: Node;
  text?: string | DocumentFragment;
  title?: string;
  type?: string;
}

function applyElementInfo<T extends Element>(element: T, options: TestDomElementInfo | string = {}): T {
  if (typeof options === 'string') {
    element.setAttribute('class', options);
    return element;
  }
  const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(/\s+/);
  if (classes) element.classList.add(...classes.filter(Boolean));
  for (const [name, value] of Object.entries(options.attr ?? {})) {
    if (value !== null) element.setAttribute(name, String(value));
  }
  if (options.href !== undefined) element.setAttribute('href', options.href);
  if (options.title !== undefined) element.setAttribute('title', options.title);
  if (options.type !== undefined) element.setAttribute('type', options.type);
  if (typeof options.text === 'string') element.textContent = options.text;
  else if (options.text) element.appendChild(options.text);
  options.parent?.appendChild(element);
  return element;
}

export function installObsidianDomHelpers(ownerWindow: Window): void {
  const ownerDocument = ownerWindow.document;
  Object.defineProperties(ownerWindow, {
    createEl: {
      configurable: true,
      value(tag: string, options?: TestDomElementInfo | string) {
        return applyElementInfo(ownerDocument.createElement(tag), options);
      },
    },
    createDiv: {
      configurable: true,
      value(options?: TestDomElementInfo | string) {
        return applyElementInfo(ownerDocument.createElement('div'), options);
      },
    },
    createFragment: {
      configurable: true,
      value() {
        return ownerDocument.createDocumentFragment();
      },
    },
    createSpan: {
      configurable: true,
      value(options?: TestDomElementInfo | string) {
        return applyElementInfo(ownerDocument.createElement('span'), options);
      },
    },
    createSvg: {
      configurable: true,
      value(tag: string, options?: TestDomElementInfo | string) {
        return applyElementInfo(ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag), options);
      },
    },
  });
  Object.defineProperty(Object.getPrototypeOf(ownerDocument) as object, 'win', {
    configurable: true,
    get(this: Document) {
      return this.defaultView;
    },
  });

  const nodePrototype = findPrototype(ownerDocument.createElement('div'), 'Node');
  Object.defineProperties(nodePrototype, {
    createEl: {
      configurable: true,
      value(this: Node, tag: string, options?: TestDomElementInfo | string) {
        const element = this.ownerDocument!.win.createEl(tag as keyof HTMLElementTagNameMap, options);
        this.appendChild(element);
        return element;
      },
    },
    createDiv: {
      configurable: true,
      value(this: Node, options?: TestDomElementInfo | string) {
        const div = this.ownerDocument!.win.createDiv(options);
        this.appendChild(div);
        return div;
      },
    },
    createSpan: {
      configurable: true,
      value(this: Node, options?: TestDomElementInfo | string) {
        const span = this.ownerDocument!.win.createSpan(options);
        this.appendChild(span);
        return span;
      },
    },
    createSvg: {
      configurable: true,
      value(this: Node, tag: string, options?: TestDomElementInfo | string) {
        const element = this.ownerDocument!.win.createSvg(tag as keyof SVGElementTagNameMap, options);
        this.appendChild(element);
        return element;
      },
    },
    instanceOf: {
      configurable: true,
      value(this: Node, constructor: typeof Node) {
        return this instanceof constructor;
      },
    },
  });

  const htmlElementPrototype = findPrototype(ownerDocument.createElement('div'), 'HTMLElement');
  Object.defineProperties(htmlElementPrototype, {
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
    setCssProps: {
      configurable: true,
      value(this: HTMLElement, properties: Record<string, string>) {
        for (const [name, value] of Object.entries(properties)) {
          this.style.setProperty(name, value);
        }
      },
    },
    setText: {
      configurable: true,
      value(this: HTMLElement, text: string) {
        this.textContent = text;
      },
    },
    toggleClass: {
      configurable: true,
      value(this: HTMLElement, className: string, force?: boolean) {
        this.classList.toggle(className, force);
      },
    },
  });
}

function findPrototype(value: object, constructorName: string): object {
  let prototype: object | null = value;
  while (prototype && prototype.constructor.name !== constructorName) {
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  if (!prototype) throw new Error(`Missing ${constructorName} prototype`);
  return prototype;
}

installObsidianDomHelpers(window);

Object.defineProperties(globalThis, {
  activeDocument: { configurable: true, value: document },
  activeWindow: { configurable: true, value: window },
});

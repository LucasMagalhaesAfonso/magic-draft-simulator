// Shim browser globals for Node.js test environment
// The engine files use @ts-nocheck and may reference window/document
(globalThis as any).window = globalThis;
(globalThis as any).document = {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {} }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {}, removeChild() {} },
};
(globalThis as any).localStorage = {
  _data: {} as Record<string, string>,
  getItem(key: string) { return this._data[key] ?? null; },
  setItem(key: string, val: string) { this._data[key] = val; },
  removeItem(key: string) { delete this._data[key]; },
  clear() { this._data = {}; },
};
(globalThis as any).alert = () => {};
(globalThis as any).confirm = () => true;
(globalThis as any).CustomEvent = class CustomEvent {
  type: string; detail: any;
  constructor(type: string, opts?: any) { this.type = type; this.detail = opts?.detail; }
};
(globalThis as any).dispatchEvent = () => {};
if (!(globalThis as any).window.dispatchEvent) {
  (globalThis as any).window.dispatchEvent = () => {};
}

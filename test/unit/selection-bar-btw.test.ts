import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn() }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { useSelectionActions, canInsertIntoBtw, insertIntoBtw } = await import("../../client/components/selection-actions");
const { copyText } = await import("@getpaseo/plugin/client/react-native");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");

// Only the DOM boundary is simulated; the hook, controller, and bar are real.
class ElementMock extends EventTarget {
  static ELEMENT_NODE = 1;
  nodeType = 1;
  dataset: Record<string, string> = {};
  children: ElementMock[] = [];
  parentElement: ElementMock | null = null;
  shadowRoot: ElementMock | null = null;
  className = "";
  textContent = "";
  offsetWidth = 180;
  offsetHeight = 30;
  private classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  private properties = new Map<string, string>();
  style = {
    setProperty: (key: string, value: string) => this.properties.set(key, value),
    getPropertyValue: (key: string) => this.properties.get(key) ?? "",
  };
  attributes = new Set<string>();
  setAttribute(name: string) { this.attributes.add(name); }
  toggleAttribute(name: string, enabled: boolean) { if (enabled) this.attributes.add(name); else this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  attachShadow() { return this.shadowRoot = new ElementMock(); }
  appendChild(child: ElementMock) { child.parentElement = this; this.children.push(child); return child; }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); }
  btw = false;
  closest(selector: string) { return selector === "[data-bcselection]" || (selector === "[data-btw-thread]" && this.btw) ? this : null; }
}

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d23c3c",
});
function Actions() { useSelectionActions(tokens, true); return null; }

let selectedElement: ElementMock;
const btwButton = () => body.children[0]!.shadowRoot!.children[1]!.children[2]! as ElementMock & { hidden: boolean };
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let page: EventTarget;
let doc: EventTarget;
let body: ElementMock;
let selection: { isCollapsed: boolean; toString(): string };
const display = () => body.children[0]!.style.getPropertyValue("display");
function select() { doc.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(0); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__rnMockOS", "web");
  vi.stubGlobal("Node", ElementMock);
  page = new EventTarget();
  doc = new EventTarget();
  body = new ElementMock();
  const text = selectedElement = new ElementMock();
  selection = Object.assign({
    isCollapsed: false, toString: () => "selected output", rangeCount: 1,
    anchorNode: text, focusNode: text,
    getRangeAt: () => ({ commonAncestorContainer: text,
      getClientRects: () => [{ left: 120, top: 200, bottom: 220, width: 100, height: 20 }],
    }),
  });
  vi.stubGlobal("window", Object.assign(page, {
    setTimeout, clearTimeout, innerWidth: 1024, innerHeight: 768, getSelection: () => selection,
  }));
  vi.stubGlobal("document", Object.assign(doc, { body, createElement: () => new ElementMock() }));
  act(() => { renderer = TestRenderer.create(React.createElement(Actions)); });
  select();
  expect(display()).toBe("block");
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.mocked(copyText).mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selection bar BTW", () => {
  it("hides Add to BTW outside a BTW target and reveals it when the ancestor acquires data-btw-thread", () => {
    expect(btwButton().hidden).toBe(true);
    expect(canInsertIntoBtw(selectedElement as unknown as Element)).toBe(false);
    selectedElement.btw = true;
    select();
    expect(btwButton().hidden).toBe(false);
    expect(canInsertIntoBtw(selectedElement as unknown as Element)).toBe(true);
    selectedElement.btw = false;
    select();
    expect(btwButton().hidden).toBe(true);
  });

  it("dispatches a cancelable bubbling snippet and flashes Added only on acceptance", () => {
    selectedElement.btw = true;
    const received: unknown[] = [];
    selectedElement.addEventListener("paseo:btw-insert", (event) => {
      received.push([(event as CustomEvent).detail, event.bubbles, event.cancelable]);
      event.preventDefault();
    });
    select();
    btwButton().dispatchEvent(new Event("click"));
    expect(received).toEqual([[{ text: "> selected output\n\n" }, true, true]]);
    expect(btwButton().children.at(-1)!.textContent).toBe("Added");
    expect(insertIntoBtw("", selectedElement as unknown as Element)).toBe(false);
    expect(insertIntoBtw("text", null)).toBe(false);
  });

  it("copies raw text and flashes Copied instead when event is unhandled", async () => {
    selectedElement.btw = true;
    select();
    btwButton().dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(copyText).toHaveBeenCalledWith("selected output");
    expect(btwButton().children.at(-1)!.textContent).toBe("Copied instead");
  });
  it("waits for fallback copying to settle before showing success", async () => {
    let finish!: () => void;
    vi.mocked(copyText).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    selectedElement.btw = true;
    select();
    btwButton().dispatchEvent(new Event("click"));
    expect(btwButton().hasAttribute("data-done")).toBe(false);
    expect(btwButton().children.at(-1)!.textContent).toBe("Copying");
    finish();
    await Promise.resolve();
    expect(btwButton().children.at(-1)!.textContent).toBe("Copied instead");
    expect(btwButton().hasAttribute("data-done")).toBe(true);
  });

  it("shows Couldn't copy without a checkmark and keeps the selection available for retry", async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error("denied"));
    selectedElement.btw = true;
    select();
    btwButton().dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(btwButton().children.at(-1)!.textContent).toBe("Couldn't copy");
    expect(btwButton().hasAttribute("data-done")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(display()).toBe("block");
    expect(selection.toString()).toBe("selected output");
    btwButton().dispatchEvent(new Event("click"));
    await Promise.resolve();
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(btwButton().children.at(-1)!.textContent).toBe("Copied instead");
    expect(btwButton().hasAttribute("data-done")).toBe(true);
  });

});

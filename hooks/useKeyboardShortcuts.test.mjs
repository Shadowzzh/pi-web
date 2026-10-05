import assert from "node:assert/strict";
import test from "node:test";
import { handleGlobalEscape, handleGlobalSidebarToggle, registerAbortHandler } from "./useKeyboardShortcuts.ts";

function keydown(key, {
  tagName = "BUTTON",
  defaultPrevented = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  shiftKey = false,
  repeat = false,
} = {}) {
  return {
    key,
    target: { tagName },
    defaultPrevented,
    ctrlKey,
    metaKey,
    altKey,
    shiftKey,
    repeat,
    preventDefault() { this.defaultPrevented = true; },
  };
}

test("Escape stops a running agent when nothing else took the key", (t) => {
  let stopped = 0;
  registerAbortHandler(() => { stopped += 1; });
  t.after(() => registerAbortHandler(null));

  const event = keydown("Escape");
  assert.equal(handleGlobalEscape(event), true);
  assert.equal(stopped, 1);
  assert.equal(event.defaultPrevented, true);
  // Focus on the page itself, as after a click on nothing in particular.
  assert.equal(handleGlobalEscape(keydown("Escape", { tagName: "BODY" })), true);
  assert.equal(stopped, 2);
  assert.equal(handleGlobalEscape(keydown("Enter")), false);
  assert.equal(stopped, 2);
});

test("an Escape something nearer already handled does not stop the agent too", (t) => {
  let stopped = 0;
  registerAbortHandler(() => { stopped += 1; });
  t.after(() => registerAbortHandler(null));

  // Settings, the Mermaid viewer or a menu closed on it and marked it handled.
  assert.equal(handleGlobalEscape(keydown("Escape", { defaultPrevented: true })), false);
  // ChatInput and other fields keep their own Escape.
  assert.equal(handleGlobalEscape(keydown("Escape", { tagName: "TEXTAREA" })), false);
  assert.equal(handleGlobalEscape(keydown("Escape", { tagName: "INPUT" })), false);
  assert.equal(stopped, 0);
});

test("with no run to stop, Escape is left alone", () => {
  registerAbortHandler(null);
  const event = keydown("Escape");
  assert.equal(handleGlobalEscape(event), false);
  assert.equal(event.defaultPrevented, false);
});

// ---------------------------------------------------------------------------
// Ctrl/Cmd+B: show or hide the sidebar
// ---------------------------------------------------------------------------

test("Ctrl+B and Cmd+B both toggle the sidebar and take the key", () => {
  let toggles = 0;
  const toggle = () => { toggles += 1; };

  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    const event = keydown("b", modifier);
    assert.equal(handleGlobalSidebarToggle(event, toggle), true);
    assert.equal(event.defaultPrevented, true, "the browser must not act on it as well");
  }
  assert.equal(toggles, 2);

  // Caps Lock reports an uppercase key with no Shift held.
  const capsLock = keydown("B", { metaKey: true });
  assert.equal(handleGlobalSidebarToggle(capsLock, toggle), true);
  assert.equal(toggles, 3);

  // It reaches the sidebar from a field too: the composer has no Ctrl/Cmd+B.
  assert.equal(handleGlobalSidebarToggle(keydown("b", { ctrlKey: true, tagName: "TEXTAREA" }), toggle), true);
  assert.equal(toggles, 4);
});

test("every other Ctrl/Cmd+B key belongs to someone else", () => {
  let toggles = 0;
  const toggle = () => { toggles += 1; };

  // A bare B types into the composer.
  assert.equal(handleGlobalSidebarToggle(keydown("b"), toggle), false);
  // Alt+B is missing from most layouts and the page may want it.
  assert.equal(handleGlobalSidebarToggle(keydown("b", { ctrlKey: true, altKey: true }), toggle), false);
  // Ctrl+Shift+B is the browser's own bookmarks bar.
  assert.equal(handleGlobalSidebarToggle(keydown("b", { ctrlKey: true, shiftKey: true }), toggle), false);
  // The neighbouring global shortcuts.
  assert.equal(handleGlobalSidebarToggle(keydown("n", { ctrlKey: true, altKey: true }), toggle), false);
  assert.equal(handleGlobalSidebarToggle(keydown("Escape", { ctrlKey: true }), toggle), false);
  assert.equal(toggles, 0);
});

test("a Ctrl/Cmd+B the toggle cannot or must not take is left alone", () => {
  let toggles = 0;
  const toggle = () => { toggles += 1; };

  // Nothing to toggle: the hook mounted without the option.
  assert.equal(handleGlobalSidebarToggle(keydown("b", { metaKey: true }), undefined), false);
  // Something nearer took it, as the Mermaid viewer does with Esc.
  assert.equal(handleGlobalSidebarToggle(keydown("b", { metaKey: true, defaultPrevented: true }), toggle), false);
  // A held key keeps repeating; one press toggles once.
  assert.equal(handleGlobalSidebarToggle(keydown("b", { metaKey: true, repeat: true }), toggle), false);
  assert.equal(toggles, 0);
});

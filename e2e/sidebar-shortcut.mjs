import assert from "node:assert/strict";

/**
 * Ctrl/Cmd+B shows and hides the sidebar from anywhere on the page, while the
 * keys that belong to a field or to the browser keep theirs. Runs at both
 * viewport widths: the class is what the open and the closed sidebar share,
 * since the panel itself is always mounted.
 */
export async function checkSidebarShortcut(page) {
  const sidebar = page.locator("#session-sidebar");
  const isOpen = () => sidebar.evaluate((element) => element.classList.contains("sidebar-open"));
  const startedOpen = await isOpen();
  // Start from open so the round trips below cover both directions. Clicking is
  // safe here: a closed sidebar is what leaves the top bar uncovered.
  if (!startedOpen) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  assert.equal(await isOpen(), true, "The sidebar must start open");

  for (const shortcut of ["Control+b", "Meta+b"]) {
    await page.keyboard.press(shortcut);
    assert.equal(await isOpen(), false, `${shortcut} must hide the sidebar`);
    await page.keyboard.press(shortcut);
    assert.equal(await isOpen(), true, `${shortcut} must show the sidebar again`);
  }

  // A bare B and the browser's own Ctrl+Shift+B are not the shortcut.
  await page.keyboard.press("b");
  assert.equal(await isOpen(), true, "A bare B must not toggle the sidebar");
  await page.keyboard.press("Control+Shift+b");
  assert.equal(await isOpen(), true, "The browser keeps Ctrl+Shift+B");

  const hide = page.getByRole("button", { name: "Hide sidebar", exact: true });
  assert.equal(await hide.getAttribute("aria-keyshortcuts"), "Control+B Meta+B", "The toggle must name the shortcut");

  // Leave the layout as it was found: below the mobile breakpoint an open
  // sidebar is an overlay over the page, and the checks that follow click into
  // it. The next toggle goes through the shortcut, which the overlay cannot cover.
  if (!startedOpen) {
    await page.keyboard.press("Control+b");
    assert.equal(await isOpen(), false, "The sidebar must be left as it was found");
  }
  console.log(`PASS: sidebar Ctrl/Cmd+B toggle at ${page.viewportSize().width}px`);
}

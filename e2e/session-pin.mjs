import assert from "node:assert/strict";
import { join } from "node:path";

/** Rows are absolutely positioned by index, so sort by `top` rather than DOM order. */
const READ_ORDER = `(() => Array.from(document.querySelectorAll("[data-session-row]"))
  .map((node) => ({
    id: node.getAttribute("data-session-row"),
    top: parseFloat(node.parentElement?.style.top ?? "0") || 0,
  }))
  .sort((a, b) => a.top - b.top)
  .map((entry) => entry.id))()`;

export async function checkSessionPinning(page, artifacts, width) {
  const orderedIds = () => page.evaluate(READ_ORDER);

  await page.locator("[data-session-row]").first().waitFor({ state: "visible" });
  const initialOrder = await orderedIds();
  assert.ok(initialOrder.length >= 2, `expected several session rows, saw ${initialOrder.length}`);

  // Pin the last row so the resulting reorder cannot be confused with the
  // activity order the list already had.
  const target = initialOrder.at(-1);
  const row = page.locator(`[data-session-row="${target}"]`);

  await row.click({ button: "right" });
  const menu = page.locator("[data-session-row-menu]");
  await menu.waitFor({ state: "visible" });
  await page.screenshot({ path: join(artifacts, `session-pin-menu-${width}.png`) });

  await page.getByRole("menuitem", { name: "Pin to top", exact: true }).click();
  await menu.waitFor({ state: "hidden" });

  await page.waitForFunction((expected) => {
    const rows = Array.from(document.querySelectorAll("[data-session-row]"))
      .map((node) => ({
        id: node.getAttribute("data-session-row"),
        top: parseFloat(node.parentElement?.style.top ?? "0") || 0,
      }))
      .sort((a, b) => a.top - b.top);
    return rows[0]?.id === expected;
  }, target);
  assert.notEqual(initialOrder[0], target, "the fixture pinned row was not already first");
  assert.equal((await orderedIds())[0], target, "pinned session sorts first");
  assert.equal(
    await row.getAttribute("data-session-pinned"),
    "true",
    "pinned rows are marked without hovering",
  );
  await page.screenshot({ path: join(artifacts, `session-pinned-${width}.png`) });

  // Pinning is a per-browser preference, not session data: it must survive reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await row.waitFor({ state: "visible" });
  assert.equal((await orderedIds())[0], target, "pin survives a reload");
  assert.equal(await row.getAttribute("data-session-pinned"), "true");

  // Unpinning must restore the activity order exactly and clear the marker.
  await row.click({ button: "right" });
  await menu.waitFor({ state: "visible" });
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await menu.waitFor({ state: "hidden" });
  await page.waitForFunction((expected) => {
    const rows = Array.from(document.querySelectorAll("[data-session-row]"))
      .map((node) => ({
        id: node.getAttribute("data-session-row"),
        top: parseFloat(node.parentElement?.style.top ?? "0") || 0,
      }))
      .sort((a, b) => a.top - b.top);
    return rows[0]?.id !== expected;
  }, target);
  assert.deepEqual(await orderedIds(), initialOrder, "unpinning restores the activity order");
  assert.equal(await row.getAttribute("data-session-pinned"), null);

  console.log(`PASS: ${width}px session pinning via row context menu, reload persistence, and unpin restore`);
}

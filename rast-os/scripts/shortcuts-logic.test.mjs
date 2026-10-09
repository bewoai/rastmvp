// Çalıştırma: npm test  (Node'un yerleşik test runner'ı + type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { GOTO_SHORTCUTS, gotoHref, isTypingTarget } from "../src/lib/shortcuts.ts";

test("kısayollar: g + harf tablosu", () => {
  assert.equal(gotoHref("b"), "/");
  assert.equal(gotoHref("g"), "/tasks");
  assert.equal(gotoHref("P"), "/projects");
  assert.equal(gotoHref("m"), "/crm/clients");
  assert.equal(gotoHref("f"), "/finance/invoices");
  assert.equal(gotoHref("t"), "/teklifler");
  assert.equal(gotoHref("l"), "/crm/leads");
  assert.equal(gotoHref("x"), undefined);
  assert.equal(new Set(GOTO_SHORTCUTS.map((s) => s.key)).size, GOTO_SHORTCUTS.length);
});

test("isTypingTarget: metin alanlarında kısayol yok, düğme / onay kutusunda var", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "SPAN", closest: (s) => (s.includes("contenteditable") ? {} : null) }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON", closest: () => null }), false);
  assert.equal(isTypingTarget(null), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { clean, changedOnly } = require("../src/lib/audit");

test("clean() removes secrets and binary blobs, keeps normal fields", () => {
  const out = clean({ id: 1, name: "x", password_hash: "h", receipt_data: Buffer.from("a"), screenshot_data: "z", token_version: 3, amount: 5 });
  assert.deepEqual(out, { id: 1, name: "x", amount: 5 });
});

test("changedOnly() keeps only differing fields on both sides", () => {
  const { before, after } = changedOnly({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, c: 3, d: 4 });
  assert.deepEqual(before, { b: 2, d: undefined });
  assert.deepEqual(after, { b: 9, d: 4 });
});

test("changedOnly() of identical objects is empty", () => {
  const { after } = changedOnly({ a: 1 }, { a: 1 });
  assert.deepEqual(after, {});
});

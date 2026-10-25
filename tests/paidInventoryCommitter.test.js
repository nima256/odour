const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaidInventoryCommitter } = require("../services/paidInventoryCommitter");

function makeFixture({ stock = 5, reserved = false, restored = false, failWrite = false } = {}) {
  const db = { _id: "order-1", OrderNum: "ORD-1", inventoryReserved: reserved, inventoryRestored: restored, inventoryProcessing: false };
  const item = { product: "product-1", quantity: 2 };
  const order = { ...db, products: [item] };
  let count = stock;
  let reserveCalls = 0;
  let writeFails = failWrite;
  const Order = {
    async findOneAndUpdate(filter, update) {
      if (db.inventoryReserved || db.inventoryRestored || db.inventoryProcessing) return null;
      Object.assign(db, update.$set);
      return { ...db };
    },
    async updateOne(_filter, update) {
      if (writeFails && update.$set?.inventoryReserved) {
        writeFails = false;
        throw new Error("DB acknowledge lost");
      }
      Object.assign(db, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete db[key];
      return { matchedCount: 1 };
    },
    async findById() { return { ...db }; },
  };
  const reserveInventory = async (items) => {
    reserveCalls++;
    const quantity = items.reduce((sum, p) => sum + p.quantity, 0);
    if (count < quantity) throw new Error("insufficient stock");
    count -= quantity;
  };
  const commit = createPaidInventoryCommitter({ Order, reserveInventory, logger: { error() {} } });
  return { order, db, commit, count: () => count, reserveCalls: () => reserveCalls };
}

test("payment pending/cancelled does not debit inventory (commit only on verified success)", async () => {
  const f = makeFixture();
  assert.equal(f.count(), 5);
  assert.equal(f.reserveCalls(), 0);
  // Checkout and failure paths do not invoke the successful-payment committer.
  assert.equal(f.db.inventoryReserved, false);
});

test("successful callback debits the right quantity exactly once", async () => {
  const f = makeFixture();
  assert.equal(await f.commit(f.order), true);
  assert.equal(f.count(), 3);
  assert.equal(await f.commit(f.order), true);
  assert.equal(f.count(), 3);
  assert.equal(f.reserveCalls(), 1);
});

test("duplicate simultaneous callback cannot double-debit", async () => {
  const f = makeFixture();
  const results = await Promise.all([f.commit({ ...f.order }), f.commit({ ...f.order })]);
  assert.ok(results.includes(true));
  assert.equal(f.count(), 3);
  assert.equal(f.reserveCalls(), 1);
});

test("legacy pre-reserved paid orders are not debited again", async () => {
  const f = makeFixture({ reserved: true });
  assert.equal(await f.commit(f.order), true);
  assert.equal(f.count(), 5);
  assert.equal(f.reserveCalls(), 0);
});

test("insufficient stock never becomes negative; paid order records a fulfillment warning", async () => {
  const f = makeFixture({ stock: 1 });
  assert.equal(await f.commit(f.order), false);
  assert.equal(f.count(), 1);
  assert.equal(f.db.inventoryReserved, false);
  assert.equal(f.db.inventoryProcessing, false);
  assert.match(f.db.inventoryCommitError, /insufficient stock/);
});

test("uncertain DB write after debit retains lock to prevent another debit", async () => {
  const f = makeFixture({ failWrite: true });
  assert.equal(await f.commit(f.order), false);
  assert.equal(f.count(), 3);
  assert.equal(f.db.inventoryProcessing, true);
  assert.equal(await f.commit(f.order), false);
  assert.equal(f.count(), 3);
});

test("late payment for previously cancelled order is flagged, never debited", async () => {
  const f = makeFixture({ restored: true });
  assert.equal(await f.commit(f.order), false);
  assert.equal(f.count(), 5);
  assert.match(f.db.inventoryCommitError, /نیازمند بررسی دستی/);
});

// Real stock is debited ONLY after the gateway confirms payment.
// Dependencies are injected for deterministic tests without a database/gateway.
function createPaidInventoryCommitter({ Order, reserveInventory, logger = console }) {
  return async function commitConfirmedPaymentInventory(order) {
    // Orders created before this change already reserved stock on checkout.
    if (order.inventoryReserved && !order.inventoryRestored) return true;
    if (order.inventoryRestored) {
      const error = "پرداخت پس از لغو سفارش و آزادسازی موجودی تأیید شد؛ نیازمند بررسی دستی";
      order.inventoryCommitError = error;
      await Order.updateOne({ _id: order._id }, { $set: { inventoryCommitError: error } });
      return false;
    }

    // One processor per order, even if two bank callbacks arrive together.
    // A lock left after an unexpected server crash is deliberately NOT retried
    // automatically: stock may already have been deducted when the crash occurred.
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        inventoryReserved: { $ne: true },
        inventoryRestored: { $ne: true },
        inventoryProcessing: { $ne: true },
      },
      { $set: { inventoryProcessing: true, inventoryProcessingStartedAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      const latest = await Order.findById(order._id);
      return Boolean(latest?.inventoryReserved && !latest?.inventoryRestored);
    }

    let stockApplied = false;
    try {
      // reserveInventory makes conditional, atomic stock decrements for the
      // product and its selected color/size. It rolls back partial failures.
      await reserveInventory(order.products);
      stockApplied = true;
      const result = await Order.updateOne(
        { _id: order._id },
        {
          $set: { inventoryReserved: true, inventoryRestored: false, inventoryProcessing: false },
          $unset: { inventoryProcessingStartedAt: "", inventoryCommitError: "" },
        }
      );
      if (result?.matchedCount === 0) throw new Error("سفارش هنگام ثبت موجودی پیدا نشد");
      order.inventoryReserved = true;
      order.inventoryProcessing = false;
      order.inventoryProcessingStartedAt = undefined;
      order.inventoryCommitError = undefined;
      return true;
    } catch (error) {
      logger.error(`[Inventory][paid order ${order.OrderNum}]`, error);
      const message = String(error?.message || "خطا در کسر موجودی سفارش پرداخت‌شده").slice(0, 500);
      // If stock was already deducted, NEVER release the lock to allow a second
      // debit. Leave it for manual reconciliation after an uncertain DB write.
      const update = stockApplied
        ? { $set: { inventoryCommitError: message } }
        : {
            $set: { inventoryProcessing: false, inventoryCommitError: message },
            $unset: { inventoryProcessingStartedAt: "" },
          };
      try {
        await Order.updateOne({ _id: order._id }, update);
      } catch (saveError) {
        logger.error(`[Inventory][paid order ${order.OrderNum}] could not save reconciliation error`, saveError);
      }
      order.inventoryProcessing = stockApplied;
      order.inventoryCommitError = message;
      return false;
    }
  };
}

module.exports = { createPaidInventoryCommitter };

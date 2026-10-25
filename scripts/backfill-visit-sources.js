#!/usr/bin/env node
"use strict";
/*
 * Back-fills traffic-source fields on historical Visit documents from the data that
 * was actually recorded at the time (the stored Referer header and the request URL).
 * Nothing is guessed: a visit without a referer is classified exactly like a live
 * request without a referer ("direct").
 *
 *   node scripts/backfill-visit-sources.js                 # dry run (default): counts only
 *   node scripts/backfill-visit-sources.js --apply         # write the fields
 *   node scripts/backfill-visit-sources.js --rollback      # remove ONLY fields this script wrote
 *
 * - Only touches visits that have no `source` yet (live-tracked visits are never changed).
 * - Every document it writes is marked `sourceBackfilled: true`, so --rollback is exact.
 * - Idempotent and resumable: re-running continues where it stopped.
 * - Set SITE_URL (or SITE_BASE_URL) so internal navigation is recognised.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Visit = require("../models/Visit");
const { classifyStoredVisit, hostOf } = require("../helper/attribution");

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const rollback = argv.includes("--rollback");
const BATCH = 1000;

async function main() {
  await mongoose.connect(process.env.DB_URL || "mongodb://127.0.0.1:27017/odour");
  const collection = Visit.collection;

  if (rollback) {
    const filter = { sourceBackfilled: true };
    const count = await collection.countDocuments(filter);
    console.log(`${count} back-filled visits found.`);
    if (!apply && !argv.includes("--confirm")) {
      console.log("Dry run. Re-run with --rollback --confirm to remove the back-filled fields.");
      return;
    }
    const result = await collection.updateMany(filter, {
      $unset: { entry: "", source: "", medium: "", campaign: "", utmSource: "", referrerHost: "", sourceBackfilled: "" },
    });
    console.log(`Rolled back ${result.modifiedCount} visits.`);
    return;
  }

  const ownHosts = ["odour.ir", hostOf(process.env.SITE_URL), hostOf(process.env.SITE_BASE_URL)].filter(Boolean);
  const filter = { source: { $exists: false } };
  const total = await collection.countDocuments(filter);
  console.log(`${total} visits without source data. Own hosts: ${ownHosts.join(", ")}`);

  const summary = {};
  let ops = [];
  let written = 0;
  const cursor = collection.find(filter, { projection: { path: 1, title: 1, referer: 1, visitTimestamp: 1 } });
  for await (const visit of cursor) {
    const fields = classifyStoredVisit(visit, ownHosts);
    const key = `${fields.entry ? "entry" : "inner"}:${fields.source}`;
    summary[key] = (summary[key] || 0) + 1;
    if (apply) {
      ops.push({ updateOne: { filter: { _id: visit._id, source: { $exists: false } }, update: { $set: { ...fields, sourceBackfilled: true } } } });
      if (ops.length >= BATCH) {
        written += (await collection.bulkWrite(ops, { ordered: false })).modifiedCount;
        ops = [];
      }
    }
  }
  if (apply && ops.length) written += (await collection.bulkWrite(ops, { ordered: false })).modifiedCount;

  console.table(summary);
  console.log(apply ? `Updated ${written} visits.` : "Dry run only. Re-run with --apply to write these fields.");
}

main()
  .catch((error) => {
    console.error("Back-fill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));

const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const visitSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "",
    },
    visitorId: {
      type: String,
      required: true,
      index: true,
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    referer: {
      type: String,
    },
    // Attribution (helper/attribution.js). Optional: visits recorded before this
    // existed have none of these fields until scripts/backfill-visit-sources.js runs.
    // entry=true marks the first page of a visit (arrived from outside the site).
    entry: { type: Boolean },
    source: { type: String },
    medium: { type: String },
    campaign: { type: String },
    utmSource: { type: String },
    referrerHost: { type: String },
    visitDate: {
      type: String,
      default: () => getPersianDate(),
    },
    visitTimestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

visitSchema.index({ entry: 1, visitTimestamp: -1 });

const Visit = mongoose.model("Visit", visitSchema);

module.exports = Visit;
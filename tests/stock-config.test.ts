import {test} from "node:test";
import assert from "node:assert/strict";
import {stockPrerequisites, STOCK_INSTRUMENT} from "../lib/stock-config";

test("AAPL is a distinct equity with truthful free-tier recency", () => {
  assert.equal(STOCK_INSTRUMENT.assetClass, "us_equity");
  assert.equal(STOCK_INSTRUMENT.symbol, "AAPL");
  assert.equal(STOCK_INSTRUMENT.feed, "massive-stocks-basic");
  assert.equal(STOCK_INSTRUMENT.recency, "end-of-day");
  assert.equal(STOCK_INSTRUMENT.requestsPerMinute, 5);
  assert.equal(STOCK_INSTRUMENT.websocketAvailable, false);
});

test("missing credentials and permission leave stocks disabled", () => {
  assert.deepEqual(stockPrerequisites({}), {
    enabled: false, symbol: "AAPL",
    blockers: ["missing_credentials", "missing_redistribution_permission", "massive_basic_end_of_day_only", "stock_execution_adapter_not_implemented"],
  });
});

test("whitespace values do not satisfy credentials or permission", () => {
  assert.equal(stockPrerequisites({
    MASSIVE_API_KEY: "\t",
    AAPL_REDISTRIBUTION_APPROVAL_REFERENCE: " ",
  }).blockers.length, 4);
});

test("configured prerequisites cannot enable an unfinished adapter or expose secrets", () => {
  const result = stockPrerequisites({
    MASSIVE_API_KEY: "mock-key",
    AAPL_REDISTRIBUTION_APPROVAL_REFERENCE: "mock-approval",
  });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.blockers, ["massive_basic_end_of_day_only", "stock_execution_adapter_not_implemented"]);
  assert.doesNotMatch(JSON.stringify(result), /mock-key|mock-secret|mock-approval/);
});

test("legacy provider credentials and opt-in flags cannot bypass Massive gates", () => {
  const result = stockPrerequisites({
    APCA_API_KEY_ID: "legacy-key", APCA_API_SECRET_KEY: "legacy-secret",
    MASSIVE_REALTIME: "true", AAPL_ENABLED: "true",
  });
  assert.equal(result.enabled, false);
  assert.ok(result.blockers.includes("missing_credentials"));
  assert.ok(result.blockers.includes("missing_redistribution_permission"));
  assert.ok(result.blockers.includes("massive_basic_end_of_day_only"));
  assert.doesNotMatch(JSON.stringify(result), /legacy-key|legacy-secret/);
});

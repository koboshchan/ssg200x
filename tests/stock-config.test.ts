import {test} from "node:test";
import assert from "node:assert/strict";
import {stockPrerequisites, STOCK_INSTRUMENT} from "../lib/stock-config";
test("free IEX is realtime but single venue, not NBBO", () => {
  assert.equal(STOCK_INSTRUMENT.feed, "alpaca-iex");
  assert.equal(STOCK_INSTRUMENT.recency, "real-time");
  assert.match(STOCK_INSTRUMENT.coverage, /not consolidated NBBO/);
});
test("requires both Alpaca credentials and existing permission reference", () => {
  assert.deepEqual(stockPrerequisites({}).blockers, ["missing_credentials", "missing_redistribution_permission", "stock_runtime_not_integrated"]);
  assert.ok(stockPrerequisites({ALPACA_KEY_ID: "a", ALPACA_SECRET: " "}).blockers.includes("missing_credentials"));
});
test("no key or legacy Massive flag enables unfinished shared hooks", () => {
  const result = stockPrerequisites({ALPACA_KEY_ID: "mock-key", ALPACA_SECRET: "mock-secret", AAPL_REDISTRIBUTION_APPROVAL_REFERENCE: "mock-reference", MASSIVE_API_KEY: "old"});
  assert.equal(result.enabled, false);
  assert.deepEqual(result.blockers, ["stock_runtime_not_integrated"]);
  assert.doesNotMatch(JSON.stringify(result), /mock-|secret|old/);
});

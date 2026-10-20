import {test} from "node:test";
import assert from "node:assert/strict";
import {stockPrerequisites, STOCK_INSTRUMENT} from "../lib/stock-config";

test("AAPL is a distinct equity with truthful single-venue coverage", () => {
  assert.equal(STOCK_INSTRUMENT.assetClass, "us_equity");
  assert.equal(STOCK_INSTRUMENT.symbol, "AAPL");
  assert.match(STOCK_INSTRUMENT.coverage, /not consolidated NBBO/);
});

test("missing credentials and permission leave stocks disabled", () => {
  assert.deepEqual(stockPrerequisites({}), {
    enabled: false, symbol: "AAPL",
    blockers: ["missing_credentials", "missing_redistribution_permission", "stock_execution_adapter_not_implemented"],
  });
});

test("whitespace values do not satisfy credentials or permission", () => {
  assert.equal(stockPrerequisites({
    APCA_API_KEY_ID: " ", APCA_API_SECRET_KEY: "\t",
    AAPL_REDISTRIBUTION_APPROVAL_REFERENCE: " ",
  }).blockers.length, 3);
});

test("configured prerequisites cannot enable an unfinished adapter or expose secrets", () => {
  const result = stockPrerequisites({
    APCA_API_KEY_ID: "mock-key", APCA_API_SECRET_KEY: "mock-secret",
    AAPL_REDISTRIBUTION_APPROVAL_REFERENCE: "mock-approval",
  });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.blockers, ["stock_execution_adapter_not_implemented"]);
  assert.doesNotMatch(JSON.stringify(result), /mock-key|mock-secret|mock-approval/);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PurchaseOutbox, PRICE_CENTS, debitKey, refundKey, type MoneyApi, type Purchase, type Receipt, type PlayerSession, type GameAdapter } from "./outbox";
import { SsgClient, ApiError } from "./client";

const session: PlayerSession = { steamId64: "76561198000000001", connectionId: "connection1", pawnGeneration: "pawn1", mapGeneration: "map1" };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ssg-cs2-")), path = join(dir, "outbox.db");
  const box = new PurchaseOutbox(path, "test-server");
  box.bindApproved(session.steamId64, randomUUID(), randomUUID());
  return { path, box, clean: () => { box.close(); rmSync(dir, { recursive: true }); } };
}
class FakeApi implements MoneyApi {
  receipts = new Map<string, Receipt>();
  debitCalls = 0; refundCalls = 0; dropDebitReply = false; dropRefundReply = false;
  async byKey(key: string) { return this.receipts.get(key) ?? null; }
  async debit(p: Purchase) {
    this.debitCalls++;
    const r: Receipt = { transaction_id: randomUUID(), status: "committed", amount_cents: PRICE_CENTS, app_user_id: p.appUserId, direction: "debit", external_reference: p.id };
    this.receipts.set(debitKey(p), r);
    if (this.dropDebitReply) { this.dropDebitReply = false; throw new Error("Lost commit response"); }
    return r;
  }
  async refund(p: Purchase) {
    this.refundCalls++;
    const r: Receipt = { transaction_id: randomUUID(), status: "committed", amount_cents: PRICE_CENTS, app_user_id: p.appUserId, direction: "credit", external_reference: p.id, credit_reason: "refund", original_transaction_id: p.debitId };
    this.receipts.set(refundKey(p), r);
    if (this.dropRefundReply) { this.dropRefundReply = false; throw new Error("Lost refund response"); }
    return r;
  }
}
function game(result: "delivered" | "not_delivered" | "unknown" = "delivered") {
  return { calls: 0, async deliverOnGameThread() { this.calls++; return result; } };
}
test("outbox persisted before network; fixed price; successful purchase does not repeat", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game();
    const witness = new PurchaseOutbox(f.path, "test-server");
    assert.equal(witness.get(p.id).state, "pending_debit"); witness.close();
    assert.equal((await f.box.process(p.id, api, g)).state, "delivered");
    await f.box.process(p.id, api, g);
    assert.equal(api.debitCalls, 1); assert.equal(g.calls, 1); assert.equal(api.refundCalls, 0);
  } finally { f.clean(); }
});
test("unknown debit result reconciles same key without another debit", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game(); api.dropDebitReply = true;
    await assert.rejects(f.box.process(p.id, api, g));
    assert.equal(f.box.get(p.id).state, "pending_debit"); assert.equal(g.calls, 0);
    assert.equal((await f.box.process(p.id, api, g)).state, "delivered"); assert.equal(api.debitCalls, 1);
  } finally { f.clean(); }
});
test("insufficient funds never grants an item", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game();
    api.debit = async () => { throw new ApiError(409, "insufficient_funds"); };
    await assert.rejects(f.box.process(p.id, api, g));
    assert.equal(g.calls, 0); assert.equal(api.refundCalls, 0);
  } finally { f.clean(); }
});
test("known session/pawn/map change is no-delivery and triggers original bounded refund", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi();
    const current = { ...session, connectionId: "replacement" };
    const g: GameAdapter = { async deliverOnGameThread(captured) {
      assert.notEqual(current.connectionId, captured.connectionId); return "not_delivered";
    } };
    assert.equal((await f.box.process(p.id, api, g)).state, "refunded");
    assert.equal(api.refundCalls, 1);
    const refund = api.receipts.get(refundKey(p))!;
    assert.equal(refund.amount_cents, PRICE_CENTS);
    assert.equal(refund.original_transaction_id, f.box.get(p.id).debitId);
  } finally { f.clean(); }
});
test("lost refund response reconciles instead of issuing twice", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game("not_delivered"); api.dropRefundReply = true;
    await assert.rejects(f.box.process(p.id, api, g));
    assert.equal(f.box.get(p.id).state, "pending_refund");
    assert.equal((await f.box.process(p.id, api, g)).state, "refunded");
    assert.equal(api.refundCalls, 1); assert.equal(g.calls, 1);
  } finally { f.clean(); }
});
test("ambiguous delivery never automatically refunds or delivers again", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game("unknown");
    assert.equal((await f.box.process(p.id, api, g)).state, "manual");
    await f.box.process(p.id, api, g); assert.equal(g.calls, 1); assert.equal(api.refundCalls, 0);
  } finally { f.clean(); }
});
test("crash at delivery boundary survives reopen and cannot auto-regrant", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game();
    const db = new DatabaseSync(f.path);
    db.prepare("UPDATE purchases SET data = ? WHERE id = ?").run(JSON.stringify({ ...p, state: "delivery_attempted", debitId: randomUUID() }), p.id); db.close();
    const reopened = new PurchaseOutbox(f.path, "test-server");
    assert.equal((await reopened.process(p.id, api, g)).state, "delivery_attempted");
    reopened.close(); assert.equal(g.calls, 0); assert.equal(api.refundCalls, 0);
  } finally { f.clean(); }
});
test("duplicate workers have only one delivery claimant", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game();
    // A production API, unlike this fake, must deduplicate concurrent identical debits.
    const r = await api.debit(p);
    api.debit = async () => r;
    await Promise.all([f.box.process(p.id, api, g), f.box.process(p.id, api, g)]);
    assert.equal(g.calls, 1);
  } finally { f.clean(); }
});
test("receipt mismatches fail closed", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), g = game();
    const r = await api.debit(p); r.amount_cents = 1;
    await assert.rejects(f.box.process(p.id, api, g), /Receipt mismatch/); assert.equal(g.calls, 0);
  } finally { f.clean(); }
});
test("SteamID must remain string and approved bindings cannot silently overwrite", () => {
  const f = fixture();
  try {
    assert.throws(() => f.box.enqueueDeagle({ ...session, steamId64: 76561198000000001 as unknown as string }));
    assert.throws(() => f.box.bindApproved(session.steamId64, randomUUID(), randomUUID()));
    assert.throws(() => f.box.pending(10000));
  } finally { f.clean(); }
});
const token = "ac_" + randomUUID() + "." + "x".repeat(43);
test("HTTP client uses confidential headers, identical keys, safe transport and exact fixed payload", async () => {
  const f = fixture();
  try {
    const p = f.box.enqueueDeagle(session), api = new FakeApi(), r = await api.debit(p);
    const calls: {url: string; init: RequestInit}[] = [];
    const transport = (async (url: string | URL | Request, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/by-key/")) return Response.json({ error: { code: "unavailable" } }, { status: 404 });
      return Response.json(r, { status: 201 });
    }) as typeof fetch;
    const client = new SsgClient("https://ssg.example", "app-test", token, transport);
    assert.equal(await client.byKey(debitKey(p)), null);
    assert.equal((await client.debit(p)).transaction_id, r.transaction_id);
    const h = calls[1].init.headers as Record<string,string>;
    assert.equal(h.Authorization, "Bearer " + token); assert.equal(h["Idempotency-Key"], debitKey(p));
    assert.equal(calls[1].init.redirect, "error"); assert.equal(calls[1].init.credentials, "omit");
    assert.equal(JSON.parse(String(calls[1].init.body)).amount_cents, 70000);
    assert.ok(!calls[1].url.includes(token));
    assert.throws(() => new SsgClient("http://ssg.example", "app", token));
  } finally { f.clean(); }
});
test("link uses four random words and server-controlled Steam identity string", async () => {
  let body: Record<string, unknown> = {};
  const transport = (async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return Response.json({ request_id: randomUUID(), device_token: "d".repeat(43), user_code: body.user_code,
      verification_uri: "https://ssg.example/link", expires_at: new Date(Date.now()+600000).toISOString(), interval_seconds: 5 });
  }) as typeof fetch;
  const client = new SsgClient("https://ssg.example", "app-test", token, transport);
  const link = await client.createLink(session.steamId64, "trusted-server");
  assert.equal(link.user_code.split(" ").length, 4);
  assert.equal(body.external_subject, "cs2:trusted-server:" + session.steamId64);
  assert.deepEqual(body.scopes, ["balance:debit"]);
});

test("adapter revalidates all session generations inside scheduled synchronous callback", async () => {
  const { gameAdapter } = await import("./adapter");
  for (const changed of ["steamId64", "connectionId", "pawnGeneration", "mapGeneration"] as const) {
    let onThread = false, gives = 0;
    const adapter = gameAdapter({
      async runOnGameThread(callback) { onThread = true; try { return callback(); } finally { onThread = false; } },
      currentAuthorizedSession() { assert.equal(onThread, true); return { ...session, [changed]: "different" }; },
      eligibleForDeagle() { assert.equal(onThread, true); return true; },
      giveDeagle() { gives++; return "delivered"; },
    });
    assert.equal(await adapter.deliverOnGameThread(session), "not_delivered");
    assert.equal(gives, 0);
  }
});
test("adapter never calls a scheduling failure known-no-delivery", async () => {
  const { gameAdapter } = await import("./adapter");
  const adapter = gameAdapter({
    async runOnGameThread() { throw new Error("Scheduling timeout"); },
    currentAuthorizedSession() { return session; },
    eligibleForDeagle() { return true; },
    giveDeagle() { return "delivered"; },
  });
  assert.equal(await adapter.deliverOnGameThread(session), "unknown");
});
test("durable enqueue blocks duplicate unresolved purchases even across worker connections", () => {
  const f = fixture();
  const other = new PurchaseOutbox(f.path, "test-server");
  try {
    f.box.enqueueDeagle(session);
    assert.throws(() => other.enqueueDeagle(session), /existing purchase/);
  } finally { other.close(); f.clean(); }
});

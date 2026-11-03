import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const PRICE_CENTS = 70_000;
const sessionSchema = z.object({
  steamId64: z.string().regex(/^[0-9]{17}$/),
  connectionId: z.string().min(1).max(128),
  pawnGeneration: z.string().min(1).max(128),
  mapGeneration: z.string().min(1).max(128),
});
export type PlayerSession = z.infer<typeof sessionSchema>;
const purchaseSchema = z.object({
  id: z.string(), appUserId: z.string(), session: sessionSchema,
  state: z.enum(["pending_debit", "debited", "delivery_attempted", "delivered", "pending_refund", "refunded", "manual"]),
  debitId: z.string().optional(),
});
export type Purchase = z.infer<typeof purchaseSchema>;
export type Receipt = {
  transaction_id: string; app_user_id: string; direction: "debit" | "credit";
  status: "committed"; amount_cents: number; external_reference: string;
  credit_reason?: "refund" | "mint"; original_transaction_id?: string;
};
export interface MoneyApi {
  byKey(key: string): Promise<Receipt | null>;
  debit(p: Purchase): Promise<Receipt>;
  refund(p: Purchase): Promise<Receipt>;
}
export interface GameAdapter {
  // Called off the game thread. Must schedule ONE synchronous callback on it.
  // Callback reacquires current controller, checks authorized SteamID64, connection,
  // map and pawn generations, alive/team/buy eligibility, then gives weapon_deagle.
  // No retained native handles across await, no in-game money subtraction.
  // "not_delivered" is allowed ONLY when no engine side effect occurred.
  // Timeout after queuing, exception after give, or uncertain native result = "unknown".
  deliverOnGameThread(session: PlayerSession): Promise<"delivered" | "not_delivered" | "unknown">;
}

export class PurchaseOutbox {
  private readonly db: DatabaseSync;
  constructor(path: string, readonly serverId: string) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(serverId)) throw new Error("Invalid server instance ID");
    this.db = new DatabaseSync(path);
    // Use a protected pre-created local directory, not NFS or an ephemeral container layer.
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS bindings (steam TEXT PRIMARY KEY, app_user TEXT NOT NULL UNIQUE, grant_id TEXT NOT NULL) STRICT;`);
  }
  close() { this.db.close(); }
  bindApproved(steamId64: string, appUserId: string, grantId: string) {
    sessionSchema.shape.steamId64.parse(steamId64);
    z.string().uuid().parse(appUserId); z.string().uuid().parse(grantId);
    // Explicit unlink/relink is an operator procedure, never silently overwrite identity.
    this.db.prepare("INSERT INTO bindings VALUES (?, ?, ?)").run(steamId64, appUserId, grantId);
  }
  enqueueDeagle(session: PlayerSession): Purchase {
    session = sessionSchema.parse(session);
    const binding = this.db.prepare("SELECT app_user FROM bindings WHERE steam = ?").get(session.steamId64);
    if (!binding) throw new Error("Link your account first");
    const p: Purchase = { id: this.serverId + "." + randomUUID(), appUserId: String(binding.app_user), session, state: "pending_debit" };
    // Serialize enqueue checks across workers. An unresolved/manual purchase blocks another charge.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const unresolved = this.db.prepare("SELECT id FROM purchases WHERE json_extract(data, '$.session.steamId64') = ? AND json_extract(data, '$.state') NOT IN ('delivered','refunded') LIMIT 1").get(session.steamId64);
      if (unresolved) throw new Error("Resolve the existing purchase before buying again");
      // Durable before any API call; never enqueue a second row to retry this purchase.
      this.db.prepare("INSERT INTO purchases VALUES (?, ?)").run(p.id, JSON.stringify(p));
      this.db.exec("COMMIT");
      return p;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get(id: string): Purchase {
    const row = this.db.prepare("SELECT data FROM purchases WHERE id = ?").get(id);
    if (!row) throw new Error("Purchase not found");
    return purchaseSchema.parse(JSON.parse(String(row.data)));
  }
  pending(limit = 50): Purchase[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid batch size");
    return this.db.prepare("SELECT data FROM purchases WHERE json_extract(data, '$.state') NOT IN ('delivered','refunded','manual','delivery_attempted') ORDER BY rowid LIMIT ?")
      .all(limit).map(row => purchaseSchema.parse(JSON.parse(String(row.data))));
  }
  private transition(p: Purchase, state: Purchase["state"], debitId = p.debitId): boolean {
    const next = { ...p, state, ...(debitId ? { debitId } : {}) };
    // CAS makes a duplicate worker harmless. Never hold SQL transactions during HTTP.
    return this.db.prepare("UPDATE purchases SET data = ? WHERE id = ? AND data = ?")
      .run(JSON.stringify(next), p.id, JSON.stringify(p)).changes === 1;
  }
  private validateReceipt(p: Purchase, r: Receipt, refund: boolean) {
    if (r.status !== "committed" || r.amount_cents !== PRICE_CENTS || r.app_user_id !== p.appUserId ||
        r.external_reference !== p.id || r.direction !== (refund ? "credit" : "debit") ||
        (refund && (r.original_transaction_id !== p.debitId || r.credit_reason !== "refund"))) {
      throw new Error("Receipt mismatch; operator reconciliation required");
    }
  }
  async process(id: string, api: MoneyApi, game: GameAdapter): Promise<Purchase> {
    let p = this.get(id);
    if (p.state === "pending_debit") {
      const r = await api.byKey(debitKey(p)) ?? await api.debit(p);
      this.validateReceipt(p, r, false);
      this.transition(p, "debited", r.transaction_id);
      p = this.get(id);
    }
    if (p.state === "debited") {
      if (!this.transition(p, "delivery_attempted")) return this.get(id);
      p = this.get(id);
      let outcome: Awaited<ReturnType<GameAdapter["deliverOnGameThread"]>> = "unknown";
      try { outcome = await game.deliverOnGameThread(p.session); } catch { /* Ambiguous, never auto-refund. */ }
      this.transition(p, outcome === "delivered" ? "delivered" : outcome === "not_delivered" ? "pending_refund" : "manual");
      p = this.get(id);
    }
    // A crash in delivery_attempted is intentionally left unresolved. No re-give/refund.
    if (p.state === "pending_refund") {
      const r = await api.byKey(refundKey(p)) ?? await api.refund(p);
      this.validateReceipt(p, r, true);
      this.transition(p, "refunded");
    }
    return this.get(id);
  }
}
export const debitKey = (p: Purchase) => "cs2.debit." + p.id;
export const refundKey = (p: Purchase) => "cs2.refund." + p.id;
export const debitBody = (p: Purchase) => ({
  amount_cents: PRICE_CENTS, description: "CS2 custom buy deagle", external_reference: p.id,
});
export const refundBody = (p: Purchase) => {
  if (!p.debitId) throw new Error("No original debit");
  return { ...debitBody(p), description: "CS2 undelivered deagle refund", credit_reason: "refund" as const, original_transaction_id: p.debitId };
};

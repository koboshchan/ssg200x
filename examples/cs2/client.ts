import { randomInt } from "node:crypto";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { z } from "zod";
import { debitBody, debitKey, refundBody, refundKey, type MoneyApi, type Purchase } from "./outbox";

const receiptSchema = z.object({
  transaction_id: z.string().uuid(), app_user_id: z.string().uuid(),
  direction: z.enum(["debit", "credit"]), status: z.literal("committed"),
  amount_cents: z.number().int().positive().safe(), external_reference: z.string(),
  credit_reason: z.enum(["refund", "mint"]).optional(), original_transaction_id: z.string().uuid().optional(),
});
const pendingSchema = z.object({
  request_id: z.string().uuid(), device_token: z.string().length(43),
  user_code: z.string(), verification_uri: z.string().url(),
  expires_at: z.string().datetime(), interval_seconds: z.number().int().min(5),
});
const pollSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("approved"), app_user_id: z.string().uuid(), grant_id: z.string().uuid(), granted_scopes: z.array(z.string()) }),
  z.object({ state: z.enum(["authorization_pending", "denied", "expired"]) }),
]);
export type PendingLink = z.infer<typeof pendingSchema>;
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterSeconds?: number) {
    super("SSG request rejected: " + code); // Never include request headers/body/secrets.
  }
}
// Trusted server only. Never import into a browser or place these values in NEXT_PUBLIC_*.
export class SsgClient implements MoneyApi {
  private readonly origin: string;
  constructor(origin: string, private readonly clientId: string, private readonly secret: string, private readonly transport: typeof fetch = fetch) {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("Use an HTTPS API origin");
    if (!clientId || !/^ac_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Missing or invalid confidential credentials");
    this.origin = u.origin;
  }
  static fromEnv() {
    return new SsgClient(process.env.SSG_API_ORIGIN ?? "", process.env.SSG_CLIENT_ID ?? "", process.env.SSG_APP_SECRET ?? "");
  }
  private async request(path: string, body?: unknown, key?: string): Promise<unknown> {
    const r = await this.transport(this.origin + "/api/v1/" + path, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      signal: AbortSignal.timeout(10_000), credentials: "omit",
      headers: {
        Authorization: "Bearer " + this.secret, "X-Client-Id": this.clientId,
        Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // No automatic retry here. The durable purchase ID is the retry identity.
    const data: unknown = await r.json();
    if (!r.ok) {
      const e = z.object({ error: z.object({ code: z.string(), retry_after_seconds: z.number().optional() }) }).safeParse(data);
      throw new ApiError(r.status, e.success ? e.data.error.code : "invalid_response", e.success ? e.data.error.retry_after_seconds : undefined);
    }
    return data;
  }
  async byKey(key: string) {
    try { return receiptSchema.parse(await this.request("transactions/by-key/" + encodeURIComponent(key))); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.code === "unavailable") return null;
      throw e;
    }
  }
  async debit(p: Purchase) {
    return receiptSchema.parse(await this.request("users/" + encodeURIComponent(p.appUserId) + "/debits", debitBody(p), debitKey(p)));
  }
  async refund(p: Purchase) {
    return receiptSchema.parse(await this.request("users/" + encodeURIComponent(p.appUserId) + "/credits", refundBody(p), refundKey(p)));
  }
  async createLink(steamId64: string, serverId: string): Promise<PendingLink> {
    z.string().regex(/^[0-9]{17}$/).parse(steamId64);
    z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).parse(serverId);
    // 4 independent uniform CSPRNG words, 44 bits. Device token is separate.
    const user_code = Array.from({ length: 4 }, () => wordlist[randomInt(wordlist.length)]).join(" ");
    return pendingSchema.parse(await this.request("link-requests", {
      user_code, scopes: ["balance:debit"], external_subject: "cs2:" + serverId + ":" + steamId64,
    }));
  }
  async pollLink(link: PendingLink) {
    return pollSchema.parse(await this.request("link-requests/" + encodeURIComponent(link.request_id) + "/poll", { device_token: link.device_token }));
  }
}

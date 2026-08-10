/**
 * The X client layer (B4): one interface, two implementations.
 *
 *   XClient        — what the daemon consumes: post + readMentions, keyed by handle.
 *   DryRunXClient  — default. Records every would-be post to an in-memory log (and an
 *                    optional JSONL sink) so the whole social pipeline runs with zero
 *                    accounts. Mentions come from an injectable stub list.
 *   XApiClient     — real X API v2 over OAuth 1.0a user context, hand-rolled signing
 *                    (no dependency). Written against the public API shape; NOT yet
 *                    integration-tested — the first live post should be watched.
 *
 * Activation: the daemon wires XApiClient only when build/state/X_LIVE_OK exists and
 * per-account credentials are present in env (X_ACCT_<HANDLE>="key:secret:token:secret").
 */
import { appendFileSync } from "node:fs";

export interface XMention {
  id: string;
  authorHandle: string;
  text: string;
  atMs: number;
}

export interface XPostReceipt {
  id: string;
  /** false when the dry-run client recorded instead of posting */
  live: boolean;
}

export interface XClient {
  post(handle: string, text: string, replyToId?: string): Promise<XPostReceipt>;
  readMentions(handle: string, sinceId?: string): Promise<XMention[]>;
}

/* ── dry run ─────────────────────────────────────────────────────────────────── */

export interface DryRunRecord {
  atMs: number;
  handle: string;
  text: string;
  replyToId?: string;
}

export class DryRunXClient implements XClient {
  readonly posted: DryRunRecord[] = [];
  /** mentions the read-path will return, per handle (test stub) */
  mentions: Record<string, XMention[]> = {};
  private counter = 0;

  constructor(private readonly sinkPath?: string) {}

  async post(handle: string, text: string, replyToId?: string): Promise<XPostReceipt> {
    const rec: DryRunRecord = {
      atMs: Date.now(), handle, text,
      ...(replyToId !== undefined ? { replyToId } : {}),
    };
    this.posted.push(rec);
    if (this.sinkPath) appendFileSync(this.sinkPath, JSON.stringify(rec) + "\n");
    return { id: `dry-${++this.counter}`, live: false };
  }

  async readMentions(handle: string, sinceId?: string): Promise<XMention[]> {
    const all = this.mentions[handle] ?? [];
    return sinceId ? all.filter((m) => m.id > sinceId) : all;
  }
}

/* ── real API ────────────────────────────────────────────────────────────────── */

export interface XAccountCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

const enc = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * OAuth 1.0a HMAC-SHA1 signature (RFC 5849 §3.4.2). Exported for the pinned test vector —
 * the signature base string and key construction are the whole game.
 */
export async function signOAuth1(
  method: string,
  url: string,
  params: Record<string, string>,
  creds: { consumerSecret: string; tokenSecret: string },
): Promise<string> {
  const ordered = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k]!)}`)
    .join("&");
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(ordered)}`;
  const key = `${enc(creds.consumerSecret)}&${enc(creds.tokenSecret)}`;
  const { createHmac } = await import("node:crypto");
  return createHmac("sha1", key).update(base).digest("base64");
}

/** Minimal X API v2 client over OAuth 1.0a user context. */
export class XApiClient implements XClient {
  private readonly userIds = new Map<string, string>();

  constructor(
    private readonly credsFor: (handle: string) => XAccountCreds | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async authHeader(method: string, url: string, creds: XAccountCreds): Promise<string> {
    const oauth: Record<string, string> = {
      oauth_consumer_key: creds.apiKey,
      oauth_nonce: `${Date.now()}${Math.floor(Math.random() * 1e9)}`,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: creds.accessToken,
      oauth_version: "1.0",
    };
    const signature = await signOAuth1(method, url, oauth, {
      consumerSecret: creds.apiSecret,
      tokenSecret: creds.accessSecret,
    });
    const header = Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ");
    return `OAuth ${header}`;
  }

  async post(handle: string, text: string, replyToId?: string): Promise<XPostReceipt> {
    const creds = this.credsFor(handle);
    if (!creds) throw new Error(`no X credentials for @${handle}`);
    const url = "https://api.x.com/2/tweets";
    const body = JSON.stringify({
      text,
      ...(replyToId !== undefined ? { reply: { in_reply_to_tweet_id: replyToId } } : {}),
    });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: await this.authHeader("POST", url, creds),
        "content-type": "application/json",
      },
      body,
    });
    if (!res.ok) throw new Error(`X post failed for @${handle}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data?: { id?: string } };
    return { id: json.data?.id ?? "unknown", live: true };
  }

  async readMentions(handle: string, sinceId?: string): Promise<XMention[]> {
    const creds = this.credsFor(handle);
    if (!creds) throw new Error(`no X credentials for @${handle}`);
    let userId = this.userIds.get(handle);
    if (!userId) {
      const url = `https://api.x.com/2/users/by/username/${enc(handle)}`;
      const res = await this.fetchImpl(url, { headers: { authorization: await this.authHeader("GET", url, creds) } });
      if (!res.ok) throw new Error(`X user lookup failed for @${handle}: HTTP ${res.status}`);
      userId = ((await res.json()) as { data?: { id?: string } }).data?.id;
      if (!userId) throw new Error(`X user lookup returned no id for @${handle}`);
      this.userIds.set(handle, userId);
    }
    const url = `https://api.x.com/2/users/${userId}/mentions`;
    const fullUrl = sinceId ? `${url}?since_id=${enc(sinceId)}` : url;
    const res = await this.fetchImpl(fullUrl, { headers: { authorization: await this.authHeader("GET", fullUrl, creds) } });
    if (!res.ok) throw new Error(`X mentions failed for @${handle}: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }> };
    return (json.data ?? []).map((m) => ({
      id: m.id,
      authorHandle: m.author_id ?? "unknown",
      text: m.text,
      atMs: m.created_at ? Date.parse(m.created_at) : Date.now(),
    }));
  }
}

/** Parse the env convention: X_ACCT_<HANDLE>="apiKey:apiSecret:accessToken:accessSecret". */
export function credsFromEnv(env: Record<string, string | undefined>): (handle: string) => XAccountCreds | null {
  return (handle) => {
    const raw = env[`X_ACCT_${handle.toUpperCase().replace(/[^A-Z0-9_]/g, "")}`];
    if (!raw) return null;
    const parts = raw.split(":");
    if (parts.length !== 4 || parts.some((p) => !p)) return null;
    const [apiKey, apiSecret, accessToken, accessSecret] = parts as [string, string, string, string];
    return { apiKey, apiSecret, accessToken, accessSecret };
  };
}

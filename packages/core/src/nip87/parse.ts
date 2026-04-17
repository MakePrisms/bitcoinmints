import type { Event as NostrEvent } from "nostr-tools/core";
import type { MintAnnouncement, MintAnnouncementNetwork, MintRecommendation } from "./types";

const KNOWN_NETWORKS = new Set<MintAnnouncementNetwork>([
  "mainnet",
  "testnet",
  "signet",
  "regtest",
]);

/** Matches `[N/5]` or `[N.M/5]` anywhere in the content, with optional whitespace. */
const CONTENT_RATING_REGEX = /(\d(?:\.\d+)?)\s*\/\s*5/;

function firstTagValue(tags: string[][], name: string): string | undefined {
  for (const t of tags) {
    if (t[0] === name && typeof t[1] === "string") return t[1];
  }
  return undefined;
}

function allTagValues(tags: string[][], name: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] === name && typeof t[1] === "string") out.push(t[1]);
  }
  return out;
}

function parseNumberList(csv: string | undefined): number[] | undefined {
  if (!csv) return undefined;
  const parts = csv
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums.length > 0 ? nums : undefined;
}

function parseStringList(csv: string | undefined): string[] | undefined {
  if (!csv) return undefined;
  const parts = csv
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function parseNetwork(n: string | undefined): MintAnnouncementNetwork | undefined {
  if (!n) return undefined;
  return KNOWN_NETWORKS.has(n as MintAnnouncementNetwork)
    ? (n as MintAnnouncementNetwork)
    : undefined;
}

function parseContentMetadata(content: string): MintAnnouncement["contentMetadata"] {
  if (!content?.trim().startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as MintAnnouncement["contentMetadata"];
    }
  } catch {
    // Non-JSON content is common (e.g. "[5/5] decent") — tolerate silently.
  }
  return undefined;
}

/**
 * Parse a kind:38172 (Cashu) or kind:38173 (Fedimint) event into a
 * MintAnnouncement. Returns null when required tags (d, at least one u)
 * are missing.
 *
 * Does NOT validate the d-tag shape; pair with isValidCashuDTag(a.d) when
 * filtering the Cashu subset. Fedimint d-tag shape validation is a
 * TODO-v1.1 (federation ids have different structure).
 */
export function parseMintAnnouncement(event: NostrEvent): MintAnnouncement | null {
  if (event.kind !== 38172 && event.kind !== 38173) return null;

  const d = firstTagValue(event.tags, "d");
  if (!d) return null;

  const u = allTagValues(event.tags, "u");
  if (u.length === 0) return null;

  const n = parseNetwork(firstTagValue(event.tags, "n"));
  const contentMetadata = parseContentMetadata(event.content);

  const base: MintAnnouncement = {
    eventId: event.id,
    kind: event.kind,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    d,
    u,
    raw: event,
  };

  if (n !== undefined) base.n = n;
  if (contentMetadata !== undefined) base.contentMetadata = contentMetadata;

  if (event.kind === 38172) {
    const nuts = parseNumberList(firstTagValue(event.tags, "nuts"));
    if (nuts !== undefined) base.nuts = nuts;
  } else {
    // kind:38173 Fedimint
    const modules = parseStringList(firstTagValue(event.tags, "modules"));
    if (modules !== undefined) base.modules = modules;
  }

  return base;
}

function parseRatingFromTags(tags: string[][]): number | undefined {
  for (const t of tags) {
    if (t[0] !== "rating") continue;
    // Canonical v1 shape: ["rating","<N>","5"] (N in 0..5, max as 3rd arg).
    if (typeof t[1] === "string" && t[2] === "5") {
      const n = Number.parseFloat(t[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 5) return n;
    }
  }
  // Legacy recall-trainer emitter: ["rating","<N>"] (no max).
  for (const t of tags) {
    if (t[0] !== "rating") continue;
    if (typeof t[1] === "string" && t[2] === undefined) {
      const n = Number.parseFloat(t[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 5) return n;
    }
  }
  return undefined;
}

function parseRatingFromContent(content: string): number | undefined {
  const match = content.match(CONTENT_RATING_REGEX);
  if (!match?.[1]) return undefined;
  const n = Number.parseFloat(match[1]);
  if (Number.isFinite(n) && n >= 0 && n <= 5) return n;
  return undefined;
}

/**
 * Parse a kind:38000 event into a MintRecommendation. Returns null when
 * required tag (d) is missing. Rating parsing order per spec:
 *
 *   1. ["rating","<N>","5"] structured tag (canonical)
 *   2. ["rating","<N>"] legacy
 *   3. `[N/5]` or `N/5` regex on content
 *   4. undefined
 */
export function parseRecommendation(event: NostrEvent): MintRecommendation | null {
  if (event.kind !== 38000) return null;

  const d = firstTagValue(event.tags, "d");
  if (d === undefined) return null;

  const kStr = firstTagValue(event.tags, "k");
  const k = kStr ? Number.parseInt(kStr, 10) : Number.NaN;

  const rating = parseRatingFromTags(event.tags) ?? parseRatingFromContent(event.content);

  const rec: MintRecommendation = {
    eventId: event.id,
    kind: 38000,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    d,
    content: event.content ?? "",
    raw: event,
  };
  if (Number.isFinite(k)) rec.k = k;
  if (rating !== undefined) rec.rating = rating;

  return rec;
}

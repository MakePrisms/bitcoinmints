import { afterEach, describe, expect, it } from "vitest";
import { BitcoinmintsDB } from "./schema";

/**
 * Each test creates a fresh DB name — fake-indexeddb holds state on
 * globalThis and name collisions would leak data between tests.
 */
const freshName = () => `test-schema-${Math.random().toString(36).slice(2)}`;

const toDispose: BitcoinmintsDB[] = [];

afterEach(async () => {
  while (toDispose.length > 0) {
    const db = toDispose.pop();
    if (!db) continue;
    db.close();
    await BitcoinmintsDB.delete(db.name);
  }
});

describe("BitcoinmintsDB schema", () => {
  it("opens at version 2 with all 6 tables present", async () => {
    const db = new BitcoinmintsDB(freshName());
    toDispose.push(db);
    await db.open();

    // v2 adds the [kind+createdAt] compound index to announcements (used by
    // restoreWatermarks for bounded .last() lookups per kind).
    expect(db.verno).toBe(2);
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual(
      ["announcements", "mintAggregate", "mintInfo", "profiles", "relayLists", "reviews"].sort(),
    );
  });

  it("declares the expected primary keys per table", async () => {
    const db = new BitcoinmintsDB(freshName());
    toDispose.push(db);
    await db.open();

    const pkKey = (name: string) => db.table(name).schema.primKey.keyPath;

    // Compound PK on replaceable event tables.
    expect(pkKey("announcements")).toEqual(["pubkey", "kind", "d"]);
    expect(pkKey("reviews")).toEqual(["pubkey", "kind", "d"]);

    // Scalar PK on the rest.
    expect(pkKey("profiles")).toBe("pubkey");
    expect(pkKey("relayLists")).toBe("pubkey");
    expect(pkKey("mintInfo")).toBe("d");
    expect(pkKey("mintAggregate")).toBe("d");
  });

  it("declares the secondary indexes that readers rely on", async () => {
    const db = new BitcoinmintsDB(freshName());
    toDispose.push(db);
    await db.open();

    const indexNames = (name: string) =>
      db
        .table(name)
        .schema.indexes.map((ix) => ix.name)
        .sort();

    // announcements secondary indexes: eventId, kind, d, createdAt + compound [kind+createdAt]
    expect(indexNames("announcements")).toEqual([
      "[kind+createdAt]",
      "createdAt",
      "d",
      "eventId",
      "kind",
    ]);
    // reviews secondary indexes: eventId, d, createdAt, k
    expect(indexNames("reviews")).toEqual(["createdAt", "d", "eventId", "k"]);
    // mintInfo secondary: fetchedAt, ok
    expect(indexNames("mintInfo")).toEqual(["fetchedAt", "ok"]);
    // mintAggregate secondary: bayesianRank, updatedAt
    expect(indexNames("mintAggregate")).toEqual(["bayesianRank", "updatedAt"]);
  });

  it("starts empty", async () => {
    const db = new BitcoinmintsDB(freshName());
    toDispose.push(db);
    await db.open();

    expect(await db.announcements.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
    expect(await db.profiles.count()).toBe(0);
    expect(await db.relayLists.count()).toBe(0);
    expect(await db.mintInfo.count()).toBe(0);
    expect(await db.mintAggregate.count()).toBe(0);
  });
});

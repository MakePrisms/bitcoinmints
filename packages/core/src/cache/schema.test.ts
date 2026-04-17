import Dexie from "dexie";
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
  it("opens at version 3 with all 6 tables present", async () => {
    const db = new BitcoinmintsDB(freshName());
    toDispose.push(db);
    await db.open();

    // v3 renames mintAggregate's `bayesianRank` index → `bayesianScore` and
    // adds `avgRating` so the ranking aggregator can sort by either without
    // a full-table scan. v2 added the [kind+createdAt] compound index on
    // announcements (used by scheduler.restoreWatermarks).
    expect(db.verno).toBe(3);
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
    // mintAggregate secondary (v3): bayesianScore + avgRating (new) +
    // updatedAt. `bayesianRank` from v1 is dropped in v3.
    expect(indexNames("mintAggregate")).toEqual(["avgRating", "bayesianScore", "updatedAt"]);
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

  it("v2 → v3 upgrade clears the mintAggregate table", async () => {
    // A dev who opened the app at v2 has rows shaped
    // `{d, averageRating, bayesianRank, updatedAt}` — the `averageRating`
    // field renamed to `avgRating` in v3 and `bayesianRank` was dropped,
    // so without a migration hook those rows fail every v3 query shape
    // (the indexes point at fields the row doesn't have). The v3 upgrade
    // wipes the table and lets it repopulate from live review traffic.
    const name = freshName();
    // Open a separate Dexie handle declaring only the first two schema
    // versions so we can seed a v2-shape row before the BitcoinmintsDB
    // handle (which declares v3 and its upgrade hook) ever touches it.
    const v2 = new Dexie(name);
    v2.version(1).stores({
      announcements: "[pubkey+kind+d], eventId, kind, d, createdAt",
      reviews: "[pubkey+kind+d], eventId, d, createdAt, k",
      profiles: "pubkey, createdAt",
      relayLists: "pubkey, createdAt",
      mintInfo: "d, fetchedAt, ok",
      mintAggregate: "d, bayesianRank, updatedAt",
    });
    v2.version(2).stores({
      announcements: "[pubkey+kind+d], eventId, kind, d, createdAt, [kind+createdAt]",
    });
    await v2.open();
    // Seed a v2-shape row — the pre-rename payload.
    await v2.table("mintAggregate").put({
      d: "5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77",
      averageRating: 4,
      bayesianRank: 4 * Math.log10(11),
      updatedAt: 1_700_000_000,
    });
    expect(await v2.table("mintAggregate").count()).toBe(1);
    v2.close();

    // Reopen via BitcoinmintsDB (declares v3 + upgrade hook) — the
    // upgrade callback should clear the mintAggregate table.
    const v3 = new BitcoinmintsDB(name);
    toDispose.push(v3);
    await v3.open();
    expect(v3.verno).toBe(3);
    expect(await v3.mintAggregate.count()).toBe(0);
    // And the v3 indexes are queryable — a live review upsert would
    // repopulate via these.
    const byScore = await v3.mintAggregate.orderBy("bayesianScore").toArray();
    expect(byScore).toEqual([]);
    const byAvg = await v3.mintAggregate.orderBy("avgRating").toArray();
    expect(byAvg).toEqual([]);
  });
});

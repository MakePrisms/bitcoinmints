// Polyfill IndexedDB for the mint-list query tests. Required because
// vitest runs in Node, which has no native IndexedDB. fake-indexeddb/auto
// assigns the in-memory implementations to globalThis.indexedDB /
// IDBKeyRange / etc. Mirrors packages/core/vitest.setup.ts.
import "fake-indexeddb/auto";

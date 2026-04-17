// Polyfill IndexedDB for Dexie cache tests. Required because vitest runs in
// Node, which has no native IndexedDB. fake-indexeddb/auto assigns the
// in-memory implementations to globalThis.indexedDB / IDBKeyRange / etc.
import "fake-indexeddb/auto";

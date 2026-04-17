# bitcoinmints

nostr Cashu mint directory. v2 rebuild (read-only, strict NIP-87).

## dev

```
direnv allow
bun install
bun test
bun run typecheck
```

## workspaces

- `packages/core` — `@bitcoinmints/core` — pure TS, no DOM (nostr, nip87, cashu, cache, ranking, scheduler)
- `packages/app` — `@bitcoinmints/app` — Vite + React (coming in later PRs)

import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element not found");
}

// StrictMode is intentionally omitted. The scheduler's idempotency is
// sequenced around `startReady` so stop() must await the in-progress
// start() before closing the handle; StrictMode's double-invoke of
// effects ends up no-opping the second start (the stopped flag latches
// true after cleanup 1 completes inside start's microtask-chained body)
// which leaves the app with no active relay subscription in dev. Not a
// correctness bug in the scheduler — it's doing what its contract says —
// but the useEffect dance for sync start + async stop under double-invoke
// is not worth the churn for a data-dump X-ray. Production mounts once.
// PR #7+ can revisit this if a more robust teardown pattern is needed.
createRoot(rootEl).render(<App />);

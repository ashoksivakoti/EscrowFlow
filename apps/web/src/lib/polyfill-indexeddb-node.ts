/**
 * WalletConnect reads IndexedDB during module init. Next static generation runs in
 * Node workers where `indexedDB` is missing; polyfill before wagmi/RainbowKit config.
 */
if (typeof globalThis.indexedDB === "undefined") {
  const { indexedDB, IDBKeyRange } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node SSG; skipped when real indexedDB exists
    require("fake-indexeddb") as typeof import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

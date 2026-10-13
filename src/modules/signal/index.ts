export { SIGNAL_SOURCES } from "./source-registry";
export type { SignalSourceDef, SignalCategory } from "./source-registry";
export {
  ensureSignalSources,
  runSignalCollection,
  signalHash,
  resolveCollector,
  packageSignalToEvidence,
  listSignalItems,
  listSignalSources,
} from "./signal-collection";
export type {
  SignalCandidate,
  SignalCollector,
  CollectionSummary,
} from "./signal-collection";
export { collectHackerNews, createHackerNewsCollector, HN_ALGOLIA_SOURCE_KEY, HN_ALGOLIA_SOURCE_DEF } from "./hn-collector";
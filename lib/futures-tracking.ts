import type { Setup } from './futures-analysis.ts';
export type SignalRecord = {
  firstSeen: number;
  lastSeen: number;
  lastConfirmedAt: number | null;
  confirmed: boolean;
  active: boolean;
  uncertain: boolean;
};
export type SignalState = {
  initialized: boolean;
  records: Map<string, SignalRecord>;
  unknown: Set<string>;
};
export const signalState = (): SignalState => ({
  initialized: false,
  records: new Map(),
  unknown: new Set(),
});
/** Session-only observations, not historical exchange events. Failed symbols are unknown. */
export function trackSignals(
  state: SignalState,
  setups: Setup[],
  failed: string[],
  now: number,
) {
  const present = new Set<string>(),
    failure = new Set(failed),
    departed: string[] = [];
  for (const s of setups) {
    const key = `${s.symbol}:${s.direction}:${s.strategy}`,
      old = state.records.get(key),
      confirmed = s.status === 'confirmed';
    present.add(key);
    s.change = !state.initialized
      ? 'baseline'
      : old?.active && old.uncertain
        ? 'resumed'
        : state.unknown.has(s.symbol)
          ? 'baseline'
          : !old || !old.active
            ? 'new'
            : confirmed && !old.confirmed
              ? 'new-confirmation'
              : 'ongoing';
    s.firstSeen = old?.active ? old.firstSeen : now;
    s.lastConfirmedAt = confirmed
      ? old?.active && old.confirmed
        ? old.lastConfirmedAt
        : s.confirmationTime
      : old?.active
        ? old.lastConfirmedAt
        : null;
    state.records.set(key, {
      firstSeen: s.firstSeen,
      lastSeen: now,
      lastConfirmedAt: s.lastConfirmedAt,
      confirmed,
      active: true,
      uncertain: false,
    });
  }
  for (const [key, old] of state.records) {
    if (present.has(key)) continue;
    const symbol = key.split(':')[0];
    if (failure.has(symbol)) {
      old.uncertain = true;
      continue;
    }
    if (old.active) {
      departed.push(symbol);
      old.active = false;
    }
    if (now - old.lastSeen > 86400000) state.records.delete(key);
  }
  state.unknown = failure;
  state.initialized = true;
  return [...new Set(departed)].filter(
    (symbol) => !setups.some((s) => s.symbol === symbol),
  );
}

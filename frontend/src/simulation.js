import { simulate, validateSettings } from './model.js';

export function validateResult(value) {
  if (!value || typeof value.engine !== 'string' || !value.engine.trim()) throw new Error('Simulation response is missing engine provenance.');
  for (const phase of ['before', 'after']) {
    for (const metric of ['risk', 'speed', 'delay', 'throughput', 'access']) {
      const entry = value[phase]?.[metric];
      if (!entry || !Number.isFinite(entry.mean) || !Number.isFinite(entry.ci) || entry.mean < 0 || entry.ci < 0) throw new Error(`Invalid ${phase}.${metric} result.`);
    }
  }
  for (const key of ['reduction', 'retained', 'score', 'seed', 'runs']) {
    if (!Number.isFinite(value[key])) throw new Error(`Simulation response is missing ${key}.`);
  }
  if (value.score < 0 || value.score > 100 || value.runs < 1) throw new Error('Simulation response is out of range.');
  return value;
}

/** Endpoint must implement the documented POST /simulate contract. Errors never fall back silently. */
export async function runSimulation(items, settings, { endpoint = '', fetchImpl = globalThis.fetch, signal } = {}) {
  validateSettings(settings);
  if (!endpoint) return simulate(items, settings, 42);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ schemaVersion: 1, intersection: 'penn-21st-pittsburgh', upgrades: items, settings, seed: 42 }),
  });
  if (!response.ok) throw new Error(`Simulation server returned HTTP ${response.status}.`);
  return validateResult(await response.json());
}

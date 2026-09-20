import { INTERSECTIONS, DEFAULT_INTERSECTION } from './intersections.js';
import { simulateNetwork, validateSettings } from './model.js';

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
  if (!endpoint) return simulateNetwork(items, settings, 42);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ schemaVersion: 2, intersection: 'pitt-campus-network', intersections: INTERSECTIONS.map(({id,origin,sourceUrl})=>({id,origin,sourceUrl})), upgrades: items.map(item=>({...item,intersection:item.intersection||DEFAULT_INTERSECTION})), settings, seed: 42 }),
  });
  if (!response.ok) throw new Error(`Simulation server returned HTTP ${response.status}.`);
  const result=validateResult(await response.json());
  if(!Array.isArray(result.intersections)||result.intersections.length!==INTERSECTIONS.length||new Set(result.intersections.map(site=>site.id)).size!==INTERSECTIONS.length)throw new Error('Backend must return all three intersection results.');
  for(const site of INTERSECTIONS){const value=result.intersections.find(entry=>entry.id===site.id);if(!value)throw new Error('Backend is missing '+site.name);validateResult(value);}
  return result;
}

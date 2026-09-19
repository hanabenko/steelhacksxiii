import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation, validateResult } from '../src/simulation.js';
import { DEFAULT_SETTINGS, simulate } from '../src/model.js';
import fs from 'node:fs';

test('local mode does not call the network', async () => {
  const result = await runSimulation([], DEFAULT_SETTINGS, { fetchImpl: () => assert.fail('Unexpected network request') });
  assert.equal(result.engine, 'local-surrogate-v1');
});
test('backend receives reproducible scenario and engine provenance is preserved', async () => {
  const expected = { ...simulate([]), engine: 'sumo-test-fixture' };
  const result = await runSimulation([], DEFAULT_SETTINGS, { endpoint: 'http://localhost:8000/simulate', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://localhost:8000/simulate');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).seed, 42);
    assert.equal(JSON.parse(options.body).intersection, 'penn-21st-pittsburgh');
    return { ok: true, json: async () => expected };
  } });
  assert.equal(result, expected);
});
test('backend failures and invalid payloads do not masquerade as local results', async () => {
  await assert.rejects(runSimulation([], DEFAULT_SETTINGS, { endpoint: '/simulate', fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(runSimulation([], DEFAULT_SETTINGS, { endpoint: '/simulate', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /provenance/);
  const invalid = simulate([]); invalid.after.risk.mean = NaN;
  assert.throws(() => validateResult(invalid), /after.risk/);
});
test('real map extract retains source, intersection coordinates, and valid geometries', () => {
  const map = JSON.parse(fs.readFileSync(new URL('../src/data/intersection.json', import.meta.url)));
  assert.equal(map.license, 'ODbL-1.0');
  assert.match(map.sourceUrl, /openstreetmap.org/);
  assert.ok(map.center.lat > 40.4 && map.center.lat < 40.5);
  assert.ok(map.features.some(f => f.tags.name === 'Penn Avenue' && f.tags.highway));
  assert.ok(map.features.some(f => f.tags.name === '21st Street' && f.tags.highway));
  assert.ok(map.features.filter(f => f.tags.building).length > 0);
  for (const f of map.features) for (const p of f.points) assert.ok(p.length === 2 && p.every(Number.isFinite));
});

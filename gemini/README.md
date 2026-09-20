# Interlock generative layer (Gemini)

Every piece of generated text in Interlock — the intersection briefing, the
simulation debrief, coaching, challenge scenarios, level objectives,
intervention rationale, voice intent routing, route narration — is declared in
**one file**: [`app/generation.py`](app/generation.py).

Everything else here is generic plumbing that never names a task. Adding or
changing a generation need means editing that one file; the API, the client and
the config do not change.

Self-contained, like `voice/`: own venv, own `requirements.txt`, own port. It
adds nothing to the root `pyproject.toml` and touches no file in `frontend/`,
`simulation/`, `scripts/`, `db/`, or `voice/`.

## Quick start

```sh
cd gemini
cp .env.example .env          # then paste your key into GEMINI_API_KEY
./run.sh
```

- **Task catalog** — <http://127.0.0.1:8091/generate>
- **API docs** — <http://127.0.0.1:8091/docs>
- **Health** — <http://127.0.0.1:8091/health>

`GEMINI_API_KEY` is read from `gemini/.env`, falling back to the repo-root
`.env`; a real environment variable beats both. All `*.env` files are
gitignored. **The key never reaches the browser** — the frontend calls this
service, only this service calls Google. Never put it in a `VITE_*` variable.

Your account's usable models: `curl -s http://127.0.0.1:8091/models`

## What Gemini generates in this project

| Task | What it produces | Consumed by |
| --- | --- | --- |
| `intersection_briefing` | Headline, briefing, focus points for a level | Frontend intro panel; voice `intersection_summary` |
| `simulation_debrief` | Verdict on before/after metrics and the trade-off | Impact panel; short enough to read aloud |
| `design_coaching` | Up to three affordable next moves | Game loop between attempts |
| `challenge_scenario` | Rush hour / surge / closure, with real sim settings | Game log, level select |
| `level_objectives` | Measurable objectives bound to game metrics | Objectives panel |
| `intervention_rationale` | Why an upgrade helps, citing the real Penn Ave study | Infrastructure cards |
| `voice_intent_router` | One label from the voice service's closed intent set | `voice/`, before refusing a paraphrase |
| `route_safety_narrative` | Spoken-length route walkthrough | `voice/` `route_safety` |

Each declares its `purpose` and `used_by` in the catalog, so
`GET /generate` is always an accurate map of where generated text appears.

## The grounding rule

**Gemini writes prose. It never produces numbers.**

Every figure — crash counts, speeds, throughput, budget — is computed upstream
by the data pipeline, SUMO, or the scoring engine, injected into the prompt as a
`FACTS` block, and the model is instructed to reuse those figures verbatim and
invent no others. Three mechanisms hold that line:

1. **Structured output.** Each task ships a `responseSchema`, so Gemini returns
   typed JSON, not free text. Enums constrain the classifier and the objective
   metrics to values the game already understands.
2. **Post-hoc verification.** `unverified_numbers()` extracts every numeric
   token from the output and subtracts everything reachable in the input. The
   API returns the difference on every response. **Empty means every figure
   traces back to real data**; non-empty is a visible drift signal rather than a
   silently trusted sentence.
3. **Deterministic fallbacks.** Every task defines a fallback that needs no
   model at all.

The voice service stays template-generated and does not depend on this service.
`voice_intent_router` only ever returns a *label*, so even when the two are
wired together Gemini cannot put a fact into a spoken answer.

## It never breaks the demo

`POST /generate/{task}` returns **200 with the deterministic fallback** when the
key is missing, the quota is gone, the model is slow, or the JSON comes back
malformed. The reason lands in `error` and `source` says `fallback`. Verified:
with a dead key, `challenge_scenario` still returns a playable rush-hour
scenario.

Set `GEMINI_OFFLINE=1` to force that path for offline demos and CI. Pass
`allow_fallback: false` on a request to get a 503 instead, when a caller would
rather handle the failure itself.

## Using it

```sh
curl -s -X POST http://127.0.0.1:8091/generate/simulation_debrief \
  -H 'Content-Type: application/json' \
  -d '{"payload":{"results":{"engine":"sumo-1.27","runs":100,"score":57,
        "before":{"risk":{"mean":12},"throughput":{"mean":800}},
        "after":{"risk":{"mean":9},"throughput":{"mean":780}}},
        "placements":[{"type":"raised_crosswalk","zone":"north"}]}}'
```

From the frontend:

```js
async function generate(task, payload) {
  const response = await fetch(`http://127.0.0.1:8091/generate/${task}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  return response.json();   // { result, source, unverified_numbers, error }
}

const { result, source } = await generate('simulation_debrief', { results, placements });
impactPanel.textContent = result.verdict;
if (source === 'fallback') showBadge('offline summary');
```

Pair it with the voice service by speaking the generated line:

```js
const { result } = await generate('simulation_debrief', { results, placements });
await voice.speak(result.spoken_summary);
```

## Adding a generation need

Append one `GenerationTask` to `app/generation.py` and add it to `TASKS`. The
route, the schema endpoint and the catalog pick it up with no other change. The
test suite will then require it to declare `used_by`, carry a valid schema, build
a prompt from both a full and an empty payload, and ship a fallback that
satisfies its own required fields.

## Tests

```sh
cd gemini && ./.venv/bin/python -m unittest discover tests -v
```

21 tests, no network and no API key. They cover catalog completeness, schema
validity against the subset Gemini accepts, prompt construction from full and
empty payloads, the grounding instructions, fallback conformance, and the
number-verification logic.

## Deliberate limits

- Schemas are checked locally against Gemini's documented OpenAPI subset. That
  is not the same as Google validating them — run one live call per task after
  adding your key.
- `unverified_numbers` is a text check. It catches a fabricated figure, not a
  correct figure used in a wrong sentence. It is a signal, not a proof.
- Fallbacks are intentionally plain. If the demo shows lifeless copy, the key or
  the quota is the thing to check.
- No caching: identical payloads bill twice. Add a cache before any load beyond
  a demo.

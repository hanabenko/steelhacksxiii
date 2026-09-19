# Interlock voice interface

A self-contained ElevenLabs voice layer for the Interlock map. It answers spoken
questions about the intersection on screen — *"How safe is the path to my school?"*,
*"What street is this?"* — and reads street names, warnings, and simulation
summaries aloud.

Everything lives in this directory. It adds no dependencies to the root
`pyproject.toml`, touches no file in `frontend/`, `simulation/`, `scripts/`, or
`db/`, and runs on its own port. Delete this folder and the rest of the project is
unchanged.

## Quick start

```sh
cd voice
cp .env.example .env          # then paste your key into ELEVENLABS_API_KEY
./run.sh
```

`run.sh` creates `voice/.venv` on first run and installs `requirements.txt`. Then:

- **Demo harness** — <http://127.0.0.1:8090/demo>
- **API docs** — <http://127.0.0.1:8090/docs>
- **Health** — <http://127.0.0.1:8090/health>

The harness is the fastest way to hear it: click *Check health*, then a sample
question. Edit the scene-context JSON on the page and the answers change with it.

Without a key the service still runs and returns answer **text**; only audio is
disabled, and `/health` reports `audio_enabled: false`. Set `VOICE_TEXT_ONLY=1` to
force that mode deliberately (useful in CI).

## Where the key goes

`ELEVENLABS_API_KEY` is read from `voice/.env`, falling back to the repo-root
`.env`; a real environment variable beats both. All `*.env` files are already
gitignored.

**The key never reaches the browser.** The frontend calls this service; only this
service calls ElevenLabs. Do not put the key in a `VITE_*` variable — those are
compiled into the public bundle.

Your account's real voice IDs:

```sh
curl -s http://127.0.0.1:8090/voice/voices | python3 -m json.tool
```

## How it stays tied to the map

The voice is not a general assistant, by construction:

1. **It has no memory and no knowledge.** Every request carries a `SceneContext`
   (`app/context.py`) — the intersection, streets, budget, placements, objectives,
   crash history, route, warnings, and simulation results. That object is the only
   thing an answer can be built from.
2. **A closed intent set.** `app/intents.py` matches each question against eleven
   fixed intents. There is no language model in the answer path, so replies are
   deterministic and unit-testable.
3. **Out-of-scope questions are refused**, not improvised. "Write me a poem" gets a
   one-line redirect naming what the voice *can* answer.
4. **Missing data is admitted.** No route loaded means *"No route is selected yet"*,
   with `grounded: false` and `missing: ["route"]` so the UI can prompt. The voice
   never invents a street name, a crash count, or a metric.

Intents: `route_safety`, `street_name`, `intersection_summary`, `simulation_summary`,
`warnings`, `crash_history`, `budget`, `placements`, `objectives`, `help`,
`out_of_scope`.

`app/speech.py` rewrites text for the ear before synthesis: `$100,000` becomes
"100,000 dollars", `25 mph` becomes "25 miles per hour", `TTC` becomes "time to
collision". A test asserts no `$` or `%` survives into spoken output.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Status, and whether audio is actually available |
| `GET` | `/voice/intents` | The closed intent list, for UI hints |
| `POST` | `/voice/ask` | Text question + context → answer text and audio |
| `POST` | `/voice/speak` | Arbitrary UI text → audio (street names, warnings) |
| `POST` | `/voice/transcribe` | Recorded audio → question text |
| `POST` | `/voice/converse` | Microphone in → grounded spoken answer out |
| `GET` | `/voice/voices` | Your account's voice IDs |

`/voice/ask` returns audio as base64 alongside the text. **Audio failures never hide
the answer**: the text always comes back, with the problem in `audio_error`.

```sh
curl -s -X POST http://127.0.0.1:8090/voice/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"How safe is the path to my school?","speak":false,
       "context":{"route":{"destination":"school","legs":[
         {"street":"Fifth Avenue","speed_limit_mph":25,"has_crosswalk":true},
         {"street":"Meyran Avenue","has_crosswalk":false,"crash_count":12}]}}}'
```

> Here is the route to school. Fifth Avenue, posted at 25 miles per hour and with a
> marked crosswalk. Meyran Avenue, with no marked crosswalk and 12 recorded crashes.
> Take extra care on Meyran Avenue.

## Wiring it into the Three.js frontend

`web/voice-client.js` is a dependency-free ES module. Nothing needs installing:

```js
import { VoiceClient } from '../../voice/web/voice-client.js';

const voice = new VoiceClient({ baseUrl: 'http://127.0.0.1:8090' });

// Called fresh on every question, so answers always match what's on screen.
voice.setContext(() => ({
  intersection_name: currentIntersection.name,
  streets: currentIntersection.streets,
  focused_street: hoveredStreet?.name ?? null,
  budget: { total: BUDGET_TOTAL, spent: totalSpent() },
  placements: placements.map((p) => ({ type: p.type, zone: p.zone, cost: p.cost })),
  results: lastResults,
  warnings: activeWarnings,
}));

const { text, intent, grounded } = await voice.ask('How safe is this route?');

await voice.speak(`${street.name}, ${street.speedLimit} mph`);  // narrate a hover
voice.stop();                                                    // cut narration

await voice.startRecording();                     // push-to-talk
const reply = await voice.stopRecordingAndAsk();  // transcribe, answer, speak
```

CORS already allows `127.0.0.1:5173` and `localhost:5173`; change
`VOICE_ALLOWED_ORIGINS` for other origins. Microphone capture needs a secure
context — `127.0.0.1` counts, a LAN IP over plain HTTP does not.

## Tests

```sh
cd voice && ./.venv/bin/python -m unittest discover tests -v
```

21 tests, no network and no API key needed. They cover intent routing, refusal of
off-topic questions, the grounding guarantee (empty context never asserts a fact or
emits a number), phrasing, and speech normalization.

## Deliberate limits

- Answers are template-assembled, not generated. Phrasing is predictable and a new
  kind of question needs a new intent. That is the trade for never hallucinating a
  street name or a crash count.
- The service is stateless — no conversation history, no follow-up pronouns
  ("is *it* safe?" won't resolve). Each question stands alone.
- It reports only what the caller supplies. Accuracy of crash counts and metrics is
  the data pipeline's and simulation's responsibility, not this layer's.
- Keep `data_note` populated for safety answers so spoken output carries the same
  provenance caveat the UI shows. Simulated metrics are model output, not predictions.

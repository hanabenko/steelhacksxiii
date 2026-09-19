# Frontend working agreement

- Keep all frontend changes inside this directory. Work on `three_js_frontend` unless the user specifies otherwise.
- Run `npm test` after every major update. Run `npm run build` before handing off changes.
- Run `npm run test:e2e` after interaction, layout, or rendering changes.
- Tests protect behavior, not fixed DOM snapshots or catalog lengths. New valid tools should not break unrelated tests. Never weaken assertions or suppress failures simply to make tests pass.
- Preserve visible source attribution and distinguish real geometry from illustrative values. Never present the local surrogate as SUMO, calibrated crash risk, or measured Pittsburgh traffic.
- Keep keyboard alternatives for canvas interactions and a usable non-WebGL fallback.

# Frontend usability and consistency audit

Reviewed September 20, 2026. Scope: mode transitions, game baseline/scoring,
simulation results, walkthroughs, camera/navigation overlays, collision lifecycle,
traffic/weather inputs, assistant context, data disclosures, and recovery paths.

| Finding | Fix |
| --- | --- |
| Free simulation showed duplicate Before/After values without an intervention. | One Result column, no improvement legend, comparison toggle, or game score. SUMO study also shows selected-scenario metrics. |
| Free walkthrough required spending a game budget and placing an upgrade. | Separate simulation and game walkthroughs behind the same button. |
| Walkthrough could sit behind controls; mobile game Test button could sit underneath the tour. | Raised tour layer and reserved space below the card in both modes. Test action remains reachable and is restored afterward. |
| Collision/fire blocked the scene for about twelve simulation seconds and could remain indefinitely when paused. | Clear two real seconds after impact; restarting resets the preview and entering a SUMO replay clears it. Pedestrian injury visuals also clear after two seconds. |
| Affordability styling always assumed $100,000. | Use the actual challenge budget, including $60,000 and $80,000 challenges. |
| Free-mode numeric shortcuts opened game purchasing tools. | Upgrade shortcuts and the purchase tray are game-only. |
| Game settings hid the run action, and its handler could only run free simulations. | The settings action now tests the game design; the redundant free quick-run stays hidden. Test buttons disable together during baseline/evaluation. Fixed trial controls are disabled. |
| Game metric comparison used default-signal baseline values while the score used the challenge's signals. | Table and score now compare with the same evaluated challenge baseline, globally and per intersection. |
| Changing result scope changed the displayed challenge score. | Keep the overall challenge score while changing the metric scope. |
| A worse outcome could be described as negative accidents “prevented.” | Say “fewer” or “more” explicitly. |
| Leaving a game discarded completed free-mode results. | Restore the free simulation settings and its previous result together. |
| Free-mode status, scenario dialog, and assistant context referred to upgrades, investment, and comparison scores. | Mode-specific status, scenario details, and result-presentation guidance. |
| Car cruising speeds and reported local speed used unrelated hard-coded numbers. | Use the same exported WPRDC observation for cruising-speed variation and the local speed baseline, then apply the weather profile. |
| Data dialog incorrectly said no measured traffic was loaded and SUMO was not connected. | Describe the actual observation, historical weather, connected SUMO study, and remaining model assumptions. |
| Free-mode navigation only appeared after opening a panel. | Navigation is reachable from the initial free-mode screen. |

## Data actually used

- OSM files under `src/data` dictate mapped road paths, directed routes, bus-stop
  locations and intersection placement.
- `data/normalized/traffic_counts.parquet`: latest complete record within 200 m
  of Fifth/Meyran, selected with the same rule as SUMO. Record **428229895**, dated
  **2018-11-08**, median **16 mph**, 85th percentile **20 mph**, limit **25 mph**.
  Rebuild the offline bundle with `python frontend/scripts/export-traffic.py`.
- `weather/data/weather_daily.csv` and `weather/model.py`: historical-date
  selection plus shared speed, capacity, braking and following-distance factors.
  Rebuild with `python frontend/scripts/export-weather.py`.

## Limits retained deliberately

The campus animation is illustrative. The nearby traffic observation is old and
is not a measurement at each campus intersection. The speed-distribution shape,
bus/bike modifiers, route mix, acceleration, capacity and upgrade effects remain
assumptions. Demand sliders are scenario inputs; daily traffic is not mislabeled
as peak-hour demand. Rain/snow history is ERA5 reanalysis; extreme storm challenges
are explicit scenarios, not historical observations. Game accidents and conflict
scores are not calibrated crash predictions. The separate SUMO study provides
recorded vehicle trajectories and physical metrics, not a validated crash forecast.

## Verification

Unit tests cover weather, source speed factors, paired game baselines, and timed
collision cleanup. Browser tests cover both walkthroughs, mode isolation, budget
feedback, free-session restoration, results, and existing keyboard/mobile flows.
Final test results are recorded in the task completion message.

## Game exit follow-up

- The top toolbar shows a labeled **Exit game** action in game mode, including on narrow mobile screens and during walkthroughs.
- Exiting cancels baseline/design workers immediately. Session guards prevent a cancelled run from overwriting the restored simulation.
- Previous free-simulation settings and results are retained, with panels closed to return to the main map.
- Fixed the hidden close button on free-simulation results and refreshed toolbar icons after mode changes.

## Navigation and live conditions follow-up

- Navigation now sits 10 px below the actual header in both modes and at mobile widths.
- Following-conflict notices sit 8 px below navigation and follow its expanded/collapsed height; mobile challenge notices move below them.
- Placing a pothole or road closure resumes a paused live preview immediately. Existing traffic routing/braking reads the updated conditions on the next frame; no simulation run is required.
- The free-simulation explanation uses dark text on its light background.

## Challenge progression and road repairs

- Added Next: Simulate in Design, Next: run & view impact in Simulate, and Next challenge in Impact, with Revise design for another attempt.
- Every generated challenge now includes a pothole or an explicitly repairable damaged-road closure; rainy/storm conditions add difficulty rather than being the only problem.
- Matching Road repair removes a pothole or reopens a damaged-road closure consistently in the geometry, live traffic, and modeled capacity/delay. Ordinary work-zone closures cannot be reopened by a repair.
- Barriers remain a cheaper way to isolate a pothole, with a capacity tradeoff.
- Hazard challenges award up to 50 points for addressing hazards and up to 50 for reducing modeled accidents. This gives road reopening visible credit even when accident counts stay unchanged.

# Pitch kit

Slides (hosted, private until you share it): https://claude.ai/artifact/1RPJt8LdsifLTemcrkYDZy
Each slide has full speaker notes. Download a PPTX/PDF backup before the event.

## Which slides for how much time

| Time | Slides |
|---|---|
| **3 min** | 1 Cover, 3 Insight, 5 Live demo (switch to the app), 7 Results, 11 Close |
| **5 min** | add 2 Problem, 8 Closing the loop |
| **8 min** | add 4 Pipeline, 6 Predict then correct, 9 Exposure, 10 Engineering and limits |

## 3-minute script

**0:00 (slide 1)** "Hi, I'm [name]. When the weather says 42 degrees, it says the same thing to everyone. But a new hire hauling panels in a double-layer suit and a supervisor in the shade are not exposed to the same thing. GEOS works out what is happening to each person and warns them before it harms them."

**0:20 (slide 3)** "Here is a simulated solar-farm crew in the Thar desert: same weather, five different bodies. Arjun, a new hire on heavy work, is already in danger; the supervisor is fine. A static alarm would ring for all five, all day, and people learn to ignore a constant alarm."

**0:40 (switch to the live app, press Play)** "Five workers, one hot afternoon, real heat physics. Watch the bell: within ten minutes the count starts climbing as GEOS warns Arjun and Kiran, and every warning is listed with its reason and what to do. Click Arjun: it forecasts his core temperature reaching 38.5 in about 15 minutes. The grey line, if I switch on Ground truth, is the simulator's hidden true temperature, which the engine never sees. Down here, Warning lead time: GEOS warned 28 minutes before his true temperature crossed 38.5, and it alarmed 2 of 5 workers. The static alarm alarmed all 5. Now Follow advice, in the Simulation panel: the same shift, but workers take a shade break when warned; his peak stays at 38."

**1:40 (slide 7)** "We tested on 600 randomised shifts, tuned on separate seeds, scored against a hidden core temperature. GEOS warned ahead of 77 percent of unsafe episodes, median head start 26 minutes, with 13 percent false alarms. A static alarm has 78 percent false alarms. Following the advice cut unsafe cases by 66 percent. This is a synthetic benchmark, not clinical validation, and I say so openly."

**2:15** "It also tracks each person's own gas dose, so the worker at a leak is warned while the fixed monitor still says all clear, and the whole engine is dependency-free JavaScript that works offline, because remote sites have no network."

**2:35 (slide 11)** "The next step is a field pilot with logged core temperature to replace the synthetic benchmark with real evidence. Warn the person, not the weather. Thank you."

## Demo run-sheet

**Ten minutes before**
1. Plug in power; turn off sleep and notifications.
2. Double-click `START_DEMO.bat` (or `npm start`). It runs fully offline at http://localhost:5173.
3. Use Chrome or Edge, press F11 for full screen; adjust zoom (Ctrl +/-) until the whole detail panel fits the projector.
4. Press Restart (R) once, then leave it paused or let it autoplay; the full shift takes about 60 seconds at 6x. The floating Simulation panel can be dragged out of the way or minimised to a circle (M) for a clean full-screen view.
5. Keep the hosted URL open on your phone as a backup, and the slides open in another tab.
6. Optional: Live mode needs Wi-Fi, but falls back to a bundled snapshot automatically.

**Click path** (about 90 seconds): Restart → Play → open the bell (N) and show warnings arriving → click *Arjun Mehta* → point at the countdown and forecast → switch on *Ground truth* → scroll to *Warning lead time* → switch on *Follow advice* and replay → (if time) switch on *Comms blackout* and show the Warn stage: alerts stay local and queue for relay → open *Benchmark*. For the gas leak, pick *Platform B* in the Simulation panel.

**If something breaks:** the slides contain real screenshots of every state; the hosted URL works on a phone; `npm test` proves the logic. Do not debug live: switch to the slides.

## Numbers cheat sheet (all reproducible with `npm run bench`)

* 600 held-out shifts; calibrated on seeds 1-150, evaluated on 1000-1599. 135 unsafe, 205 near-miss, 260 clearly safe.
* GEOS: warned before unsafe 77%, 65% at least 10 min early, median 26 min, false alarms 13% (35 of 260).
* Static WBGT ≥ 28 °C alarm: 86% / 81% / 56 min / **78%** (202 of 260).
* HR-only Kalman: 30% / 24% / 61 min / 3%.  HR ≥ 85% of max: 19% / 13% / 24 min / 0%.
* Core-temperature RMSE: fusion 0.40 °C, HR-only 0.46 °C, environment-only 0.73 °C.
* Closed loop, 150 shifts: ≥ 38.5 °C 35 → 12; ≥ 39.0 °C 10 → 3; minutes above 38.5 °C 36.7 → 8.8.
* Thar demo (seed 1): Arjun warned 10:08, true crossing 10:36 (28 min); Kiran warned 10:08, crossing 10:58 (50 min). Following advice: peaks 38.00 and 38.01 °C instead of 39.08 and 38.91.
* Offshore demo: area monitor peaks 7.8 ppm; Deepak at the source 64.6 ppm, DANGER within 2 minutes.
* ILO (2024): 2.41 billion workers exposed to excessive heat, 22.85 million injuries, 18,970 deaths a year; 9 in 10 exposures happen outside heatwaves.
* Engine: 11 files, about 1,040 lines, no dependencies; 30 tests; a six-hour, five-worker shift runs in about 70 ms.

## Likely questions

**Why not deep learning?** It is safety-critical, there is no public labelled dataset for these settings, it must run on tiny offline devices, and every alert has to be explainable. State estimation (Kalman filtering) with physiology-informed priors fits all four. Learning is used where it is safe: the filter learns each worker's own drift online.

**How do you validate without real data?** Honestly, we can't yet: the benchmark is synthetic. I separated calibration seeds from evaluation seeds, used a different body model for the truth than for the estimator so it faces model mismatch, and injected sensor faults. The next step is a field pilot with logged core temperature.

**How accurate is the core-temperature estimate?** In our synthetic benchmark the RMSE is 0.40 °C. The underlying heart-rate model (Buller et al.) is what the US Army's ECTemp algorithm uses; it reported a bias of -0.03 ± 0.32 °C over 52,000 observations from 83 volunteers. Ours adds an environment prior and a personal drift term.

**What sensors would it need in reality?** A wrist or chest heart-rate sensor plus accelerometer (already in most wearables), a weather station (or the site's existing one), and the personal gas monitors that offshore and confined-space workers already wear. Core temperature is *estimated*, not measured.

**Why does a static WBGT alarm do so badly?** It is one number for everyone. NIOSH's own limit depends on workload and acclimatisation (23 °C for heavy work unacclimatised, 31 °C for light work acclimatised). Using one threshold means it either rings for all or is set so high it is late.

**What about alert fatigue?** That is the design goal: WATCH is an advisory, WARNING needs three consecutive risky samples, de-escalation is sticky, and we measure false alarms on clearly safe workers (13%).

**Privacy of health data?** Processing is on the device; only alerts need to leave it; no cloud is required. In a deployment you would minimise what the supervisor sees (alert level and location, not raw vitals) and get worker consent.

**How does it work offline?** The engine is dependency-free JavaScript; the dashboard is an installable PWA with a service worker; alerts fire locally first and queue for relay (store-and-forward). Try the comms-blackout switch.

**Is the WBGT computed properly?** It is an independent implementation of the Liljegren model (the standard way to get WBGT from weather data), including natural wet-bulb and globe heat balances and sun position. A known limitation: it assumes the ground is at air temperature, which under-reads radiant heat from very hot desert ground.

**Why 38.5 °C?** NIOSH designs its limits so average core temperature stays at or below about 38.0 °C. We warn when the forecast reaches 38.5 °C, a margin of 1.5 °C below the 40 °C of heat stroke, and use 39 °C for DANGER.

**What does the CS track contribution look like?** Data processing and quality control, state estimation, forecasting, change-point detection, an explainable alert state machine, and a reproducible evaluation harness: that is the whole product, with no hardware.

**What would you do with three more months?** Field pilot with ground-truth core temperature; Bluetooth wearable adapters and LoRa or satellite relay; personal baselines across shifts; cold and altitude stressors through the same interface.

## What not to claim

* Do not say "clinically validated" or "predicts heat stroke". Say "forecasts core-temperature risk; validated on a synthetic benchmark".
* Do not quote the 0.40 °C RMSE as real-world accuracy.
* Do not call it AI or machine learning in general terms; it is model-based state estimation, change-point detection and rule-based alerting, and that is a strength (explainable).
* Do not say it replaces medical judgment. It is decision support.

## Integrity: be ready to explain every part

This project was built with AI coding assistance. Check the hackathon's rules on AI tools and disclose it if required. Whatever the rules say, be able to explain it yourself. A 60-second walkthrough:

1. `site/src/engine/pipeline.js` is the whole flow: `Monitor.step(sample)` is called once a minute.
2. `qc.js` cleans the heart-rate stream; `wbgt.js` turns weather into WBGT; `cusum.js` finds sudden changes.
3. `estimator.js` is the Kalman filter: predict with the environment, correct with heart rate, learn a drift, forecast.
4. `alerts.js` turns the forecast into SAFE/WATCH/WARNING/DANGER with persistence and hysteresis, reasons and actions.
5. `sim/` is the hidden-truth simulator; `bench/run.mjs` scores everything; `tests/` proves the claims.

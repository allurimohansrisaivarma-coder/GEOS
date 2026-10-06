# GEOS: how to run it and what it does

## What it is (in 30 seconds)

People working in extreme places (desert, offshore, mines, the Arctic) can be hurt by heat, cold, gas or dust before they feel it. GEOS watches the weather and each worker's wearable, works out how stressed **each person's body** is, and warns them **early**, with a reason and what to do.

Same weather, different people: a new hire in a heavy suit is in danger while a supervisor in the shade is fine. A single alarm for everyone can't tell them apart. GEOS can.

## What you need

| Need | Details |
|---|---|
| **Node.js 20 or newer** | Free, from [nodejs.org](https://nodejs.org) (the "LTS" button). It is the only thing to install. |
| **A web browser** | Chrome, Edge, Firefox or Safari. |
| **A computer** | Windows, Mac or Linux. |
| **Internet** | Not required. Without it the page uses a system font and the "Live" weather mode falls back to saved weather. |

There is nothing else to install: no `npm install`, no accounts, no keys.

## Run it

**Windows (easiest):** double-click `START_DEMO.bat`. Your browser opens the app.

**Any computer:** open a terminal in this folder and run:

```bash
npm start
```

Then open <http://localhost:5173>. Press `Ctrl+C` in the terminal to stop.

If port 5173 is busy, run it on another one (Windows PowerShell: `$env:PORT=3000; npm start`, Mac/Linux: `PORT=3000 npm start`) and open that address instead.

## Try it (2 minutes)

1. Press **Play** in the floating **Simulation** panel (bottom right). Drag it anywhere, or shrink it to a circle.
2. Pick a **plant** in that panel: desert solar farm, offshore platform, coal mine or Arctic plant. Each has its own crew and hazards.
3. Click a worker in the **Crew** list. See their body-temperature estimate, how soon they would reach danger, **why**, and **what to do**.
4. Click the **bell** (top right) for every warning raised so far.
5. Click **sensors online** (top left) to see every sensor and its signal. Open a row to see its battery, make, model, year and serial number, and to **raise a maintenance ticket**, for example for a GEOS-Strap that is low on battery. The **clipboard button** beside the bell lists every ticket.
6. Try the switches: **Follow advice** (workers obey the warnings), **Ground truth** (the simulator's real temperature, which GEOS never sees) and **Comms blackout**.
7. **Benchmark** (top bar) shows the test results. **How it works** explains the steps.

Under the crew list, **Body temperature** shows everyone against the ideal range. Under the site card, **Tomorrow** shows the next day's weather as pictures and what it means for work.

Handy keys: `Space` play/pause, `R` restart, `N` notifications, `T` tickets, `M` minimise the panel.

## The four steps (the challenge's pipeline)

1. **Monitor:** read weather, heart rate and gas sensors, and throw out bad readings.
2. **Detect:** turn weather into a "felt heat" number (WBGT) and spot sudden changes like a dust front or gas leak.
3. **Assess:** estimate each worker's core body temperature from the environment, their workload, clothing and heart rate.
4. **Warn:** forecast the next hour and raise WATCH, WARNING or DANGER early, without crying wolf.

## Results, honestly

On 600 simulated work shifts GEOS warned ahead of **86%** of unsafe cases, about **27 minutes** early, with **8%** false alarms. A plain heat alarm had 78% false alarms.

**These are simulated, not real patients.** It proves the logic works under noise and sensor failures. It is not clinical proof and not a medical device.

## Other commands

```bash
npm test         # 41 automated checks that the maths, alerts and thresholds behave
npm run bench    # re-runs the 600-shift test (takes about 5 seconds)
```

## Troubleshooting

* **"node is not recognized":** install Node.js (above), then close and reopen the terminal.
* **Blank page:** make sure the terminal is still running `npm start` and you opened `http://localhost:5173`.
* **Looks stale after an update:** hard refresh (`Ctrl+Shift+R`).

## Where things are

* `site/`: the app. `site/src/engine/` is the warning brain.
* `README.md`: the full technical write-up. `PITCH.md`: talking points. `SUBMISSION.md`: form text.

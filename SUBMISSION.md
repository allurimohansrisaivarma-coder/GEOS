# Submission copy (Google Form, deadline 7 October 2026, 08:00)

The form has three fields. Copy-paste from below.

## 1. Brief Solution Title

```
GEOS: Predictive Early Warning for Environmental Stress in Remote Work
```

(Shorter alternative: `GEOS: Warn the Person, Not the Weather`)

## 2. Presentation / Project Link

There is no hosted demo. Paste the link to your **slides** (the hosted deck below, once you have used its **Share** menu to allow viewing by link) or to a Drive folder with the PDF of the deck. The app runs locally; the steps are in GUIDANCE.md.

The hosted deck is private until you share it: open it and use the page's **Share** menu to allow viewing by link (or export a PDF and put it in a Drive folder set to "anyone with the link can view"). Claude cannot change sharing for you.

Slides: https://claude.ai/artifact/1RPJt8LdsifLTemcrkYDZy

## 3. Brief Description

**Full version (about 190 words):**

```
GEOS is an early-warning system for environmental stress in deserts, offshore platforms and disaster zones. It follows the challenge pipeline end to end. MONITOR: weather, wearable heart-rate/activity and personal gas sensors, quality-checked every minute (spike, dropout and stuck-sensor handling). DETECT: heat load via the Liljegren WBGT model and sudden dust or gas events via CUSUM change-point detection. ASSESS: each person's exposure, by fusing an environment-driven heat-strain model with heart rate in an extended Kalman filter (core-temperature estimate, strain index, personal NIOSH limit, gas dose). WARN: a 60-minute forecast of time-to-threshold feeds a hysteresis alert state machine that gives reasons and actions.

The key idea: environment is not exposure. The same weather endangers a new hire in a double-layer suit but not an acclimatised supervisor, so one static threshold either rings for everyone or warns too late.

On 600 held-out synthetic shifts, GEOS warned ahead of 86% of unsafe episodes (median 27 min head start) with 8% false alarms, versus 78% false alarms for a static WBGT alarm; following its advice cut unsafe cases by 71%. Dependency-free JavaScript, runs offline on a laptop, live dashboard with real Open-Meteo weather. The benchmark is synthetic, not clinical validation.
```

**Short version (about 90 words), if the form limits length:**

```
GEOS is a predictive early-warning system for heat, toxic gas and dust in remote work. It monitors weather, wearable heart-rate and gas sensors; detects heat load (Liljegren WBGT) and sudden events (CUSUM); assesses each person's exposure by fusing an environment-driven heat-strain model with heart rate in a Kalman filter; and warns on a forecast time-to-threshold, with reasons and actions. Insight: environment is not exposure. On 600 held-out synthetic shifts it warned ahead of 86% of unsafe episodes (median 27 min) with 8% false alarms vs 78% for a static alarm. Runs offline.
```

## Before you press submit

- [ ] Run the app locally once (GUIDANCE.md), press Play and confirm the story runs.
- [ ] Open the slides link in a private window to confirm judges can view it; paste it in the form with no trailing space.
- [ ] Replace `[Your name]` on the first and last slides.
- [ ] Download the deck as PPTX or PDF as an offline backup for the in-person presentation.
- [ ] Submit before 08:00 on 7 October; the presentation schedule is shared that morning.

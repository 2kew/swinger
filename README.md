# Swinger — AI Golf Swing Coach 🏌️

A mobile-first web app that turns your phone camera into a golf coach. Record
or upload a swing, and Swinger analyzes it **entirely on your device** — no
backend, no video upload — then coaches you like a pro would.

## What it does

- **Record or upload** swings with the phone camera (front camera by default —
  set the phone down and see yourself; flip to the rear camera anytime).
- **Driving range mode** — set the phone down, record up to ~10 hits in one
  take, and every swing is found and scored automatically. Each hit gets its
  own replay, scores, and coaching, listed under the Coach tab.
- **On-device pose analysis** — [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
  runs in the browser and tracks 33 body landmarks frame by frame.
- **Swing replay** with a wire-mesh skeleton overlay and the hand trajectory
  drawn over the video, color-coded by phase, with one-tap jumps to Address,
  Top, Impact and Finish. Detected faults are tinted red, and a dashed **green
  ghost skeleton** shows the corrected body position (straightened lead arm,
  held spine angle, posted hips) — toggle it with the Fixes button.
- **8 biomechanics metrics**, each scored 0–100:

  | Metric | What's measured | Ideal |
  |---|---|---|
  | Tempo | backswing : downswing time ratio | ~3 : 1 |
  | Shoulder Turn | shoulder rotation at the top (3D) | ~90° |
  | Hip Turn | hip rotation at the top (3D), plus X-factor | ~45° |
  | Lead Arm | lead elbow angle at the top | ≥160° |
  | Head Stability | head drift from address to impact | <14% of torso |
  | Posture | spine-angle change (early extension) + knee flex | <6° change |
  | Weight Shift | hip travel toward target by impact (face-on only) | 10–40% of stance |
  | Finish | hip rotation & hand height at the finish | balanced, full |

- **Granular coaching** — for every metric: what was measured, why it matters,
  feel cues, and a specific practice drill, prioritized worst-first like a
  real lesson.
- **Multi-metric scoring** — an overall score, four category scores (Timing,
  Rotation & Power, Stability, Delivery), and a radar chart of all 8 metrics.
- **Progress tracking** — every session is saved locally; trend charts per
  metric show what's improving and what needs work.

## Running it

It's a fully static app — serve the folder over HTTPS (the camera API
requires a secure context) and open it on your phone:

```bash
# local dev (camera works on http://localhost)
python3 -m http.server 8080
```

For phone use, host it anywhere static + HTTPS, e.g. **GitHub Pages**:
Settings → Pages → deploy from branch. Then open the URL on your phone and
"Add to Home Screen" for an app-like experience.

> The pose model (~5 MB) downloads from a CDN on first analysis and is cached
> by the browser afterward. Swing videos never leave the device.

## Recording tips

- Prop the phone at waist height, 3–4 m (10–13 ft) away.
- Whole body in frame, head to feet, for the entire swing.
- Face-on view unlocks all 8 metrics (weight shift isn't visible down-the-line).
- Good light, one person in frame, one swing per clip.

## Project layout

```
index.html          app shell (4 tabs: Swing / Analysis / Coach / Progress)
css/style.css       mobile-first UI, light + dark via prefers-color-scheme
js/main.js          capture, playback overlay, rendering, tab wiring
js/pose.js          MediaPipe Pose loader + frame extraction
js/swing.js         phase detection, biomechanics metrics, scoring (pure, testable)
js/coach.js         coaching text engine (analysis / why / cues / drills)
js/charts.js        canvas radar + trend charts with tap tooltips
js/store.js         localStorage session history + settings
```

`js/swing.js` and `js/coach.js` are pure ES modules with no DOM dependency —
they run under Node for testing.

## Limitations

- Metrics come from monocular 2D/3D pose estimation — great for trends and
  coaching signals, but not launch-monitor accuracy. Club and ball are not
  tracked; the trajectory shown is the hands' path.
- Analysis quality depends on the video: full body visible, decent light,
  a single person in frame.
- This is practice feedback, not medical or professional instruction.

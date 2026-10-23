# SnipeCam — Development Plan

On-device, in-browser face recognition for the club sniping game. **Passive (tripod) mode:** phone/laptop watches while you work → recognizes club members → keeps one best photo per member per day → you batch-review → share to Slack.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` passing
**Test types:** `[U]` unit, Node (`npm test`) · `[B]` browser automated (`tests/browser.html`) · `[M]` manual on device

---

## 1. Constraints & Decisions

| Item | Decision |
|---|---|
| Targets | iPhone 17 (Safari, iOS 26), Linux laptop (Chrome/Firefox). Pi 3B+ = optional Phase 7 (Python). |
| Modes | v1 = **Tripod** only. Modes are plug-ins (`js/modes/`) so others can be added later (§4.1). Walking-around snipes = iPhone Camera app. |
| Processing | 100% on-device. No video leaves the device. |
| Power | Battery over latency. 2 fps default (500 ms), 0.5 fps idle. Dim mode (black screen). |
| Stack | Plain HTML/CSS/ES modules. No framework, no build step. |
| Face library | `@vladmandic/human@3.3.6` (detector + mesh + `faceres` 1024-d embedding) from jsDelivr; models cached in IndexedDB after first load. |
| Distant faces | Detector shrinks input to 256 px → faces < ~110 px in a 1080p frame are missed (~2 m on the 1× lens). Fix: **two-stage detection**: (1) cheap face-finding on full frame + n×n overlapping tiles (default 2×2), merge duplicates; (2) mesh + embedding once per face on an enlarged crop. Empty scenes cost only stage 1. |
| Recognition model | Human's default `faceres` (1024-d). Evaluated in P3 against `faceres-deep`, MobileFaceNet, and 4 InsightFace models on the same 44 photos: `faceres` was best (lowest error, most catches at 0.1% false match). |
| Match threshold | **0.64** (cosine, best of a member's enrolled photos). At 0.55, 17% of stranger probes matched a member on the fixture set. Re-tune with real members (T-TUNE-1). |
| Backend | `webgpu`, fallback `webgl`. |
| Hosting | GitHub Pages (public repo, HTTPS). Dev on `localhost`. |
| Storage | IndexedDB per device: roster, candidates (JPEG), daily lock log. Settings in localStorage. **No face data in the repo.** |
| Slack tags | The iOS share sheet sends the photo only (with text, Slack took a link instead). Tags are copied to the clipboard, but pasted `@handle` text isn't a real Slack mention: that needs Slack's @-picker or the Slack API with member IDs → P7 (Slack app). **Save** is the main path for now. |
| Zoom | Camera's own zoom (`applyConstraints({zoom})`) when the browser exposes it, so detail comes from the full sensor; digital crop otherwise or as top-up. Preview scales to match. |
| Roster sync | Export/import **merges**: members matched by id, then name (case/space-insensitive); photos combined, duplicates skipped (re-import is harmless); local id/name/handle kept (empty handle filled); same name but clearly different face (best similarity < 0.5) → kept separate as "Name (2)" and reported; ≤ 30 photos per member; additive (deletions don't spread). Workflow: enroll on laptop, export, import on phone (and back). |
| Locked members | Still recognized (so they can't be mistaken for someone else) but drawn gray with 🔒; no photos or alerts. |
| Offline | `sw.js`: app files network-first (fresh when online, cached offline); pinned face library cache-first; models in IndexedDB (by the library). |
| Out of scope (v1) | Slack auto-post, scoreboard, background operation (iOS forbids), other modes. |

---

## 2. Game Rules → App Behavior

Source: *Sniping Rules (Updated Spring 2026)*. Game logic lives in `js/rules.js` only.

| Rule | App behavior |
|---|---|
| 8. Same person max once/day | Max 1 pending candidate per member per day. After a member is **accepted** (shared/saved from Inbox, or marked "Sniped today"), they are ignored for the rest of the day: no candidates, no alerts. |
| 9. Post same day, before 12 am | Day = local calendar date, midnight rollover (fixed, not configurable). Pending candidates **auto-deleted at midnight**. Inbox shows "post by midnight" countdown. Reminder beep + banner at `reminderAt` (default 23:00) if candidates pending. |
| 5. One picture per snipe; multiple people OK | Inbox shares **one photo per Slack post** (sequential share sheets, one tap each). Never bundles separate snipes into one post. |
| 4. Tag everyone in the picture | Each candidate records **all** recognized members in its frame. Tag text includes all of them. Members in the photo who are already locked today are shown flagged ⚠ so you decide. Sharing locks every tagged member and removes their other pending candidates. |
| 3. Snipee distinguishable | Candidate requires face ≥ `minCandidateFacePx` (60 px); best-frame selection favors large, sharp, confident faces. |
| 6. No countersniping | Roster quick action **"Sniped me today"** → locks that member for the day. |
| 1, 1a, 1b, 2. Same event / classroom | Can't be detected automatically. Inbox shows capture time; user verifies before sharing. Don't run it in a class/meeting/rehearsal you share with members. |
| 1c. 30 min around rehearsal, West Village 175 | Optional (P6): rehearsal schedule in Settings; candidates captured within ±30 min of rehearsal flagged ⚠. Flag, not block (rule is location-based). |
| 10. Don't snipe anyone who doesn't want it | Only enroll members who've agreed. Deleting a member removes all their data. |
| 11. No stalking | Passive tripod only; no tracking/location features. |

**"Accepted" (locked for the day) sources:** `shared` · `saved` · `manual` (sniped via Camera app — "Sniped today") · `sniped-me` (countersnipe guard). Undo available in Roster for today.

**Locked ≠ removed from matching:** locked members stay in the matcher so their face isn't misidentified as someone else; their matches are just ignored.

---

## 3. File Structure

```
/
├── index.html              App shell: views as <section>s
├── manifest.json           PWA manifest (Add to Home Screen, fullscreen)
├── sw.js                   Service worker: offline app shell + face library
├── package.json            {"type":"module"}; "test": "node --test tests/unit/"
├── .gitignore              tests/fixtures/, *.snipedb.json, node_modules/
├── README.md
├── DEVELOPMENT_PLAN.md
├── icons/                  icon-192.png, icon-512.png
├── css/style.css
├── js/
│   ├── main.js             Bootstrap, state machine, generic watch loop, mode host
│   ├── loop.js             [pure] Adaptive tick delay, rolling fps/detect-time stats
│   ├── modes/
│   │   ├── index.js        Mode registry: { tripod }
│   │   └── tripod.js       Tripod mode: tracker + rules → candidates
│   ├── settings.js         [pure] Defaults, load/save/validate
│   ├── rules.js            [pure] dayKey, decide, tags, expiry, deadline, blackout
│   ├── log.js              On-screen console/error panel
│   ├── camera.js           getUserMedia start/stop/list
│   ├── device.js           Wake lock (+ fallback), audio, dim
│   ├── detector.js         Human init + detect → Face[]
│   ├── matcher.js          [pure] Cosine similarity, best match
│   ├── tracker.js          [pure] Sighting sessions → one best frame per pass
│   ├── capture.js          Grab/copy frame, crop, JPEG
│   ├── enroll.js           Photos → validated embeddings + thumbnails
│   ├── roster.js           Roster + member editor screens, today's lock actions, export/import
│   ├── rostersync.js       [pure] Merge an imported roster into this device's (rosters grow together)
│   ├── inbox.js            Inbox grid, candidate detail, share flow (one photo per post)
│   ├── clock.js            App clock (`?clockOffset` test hook)
│   ├── db.js               IndexedDB: members, candidates, locks; export/import
│   ├── share.js            Tag text, single-file share, clipboard, download
│   └── ui.js               Views, labels, inbox, roster, settings
├── tests/
│   ├── browser.html        Runs tests/browser/*.test.js, pass/fail by test ID
│   ├── harness.js          Minimal test()/assert for browser tests
│   ├── bench.html          Detector timing benchmark
│   ├── tune.html           Threshold tuning (fixtures manifest → member-level similarity stats)
│   ├── tunelib.js          [pure] Pair/member-level similarities, rates, suggested threshold
│   ├── unit/               *.test.js for [pure] modules
│   ├── browser/            *.test.js needing DOM/camera/IndexedDB/Human
│   └── fixtures/           GITIGNORED. people/<name>/*.jpg, blank.png, group.jpg
└── tools/
    ├── serve.sh            python3 -m http.server 8000
    ├── fetch-fixtures.sh   Sample faces (Human repo, MIT) + fake-camera video → tests/fixtures/
    ├── testlib.mjs         Playwright helpers (throwaway server, engines with fake camera)
    ├── test-browser.mjs    Runs tests/browser.html in Chromium/Firefox/WebKit
    ├── test-app.mjs        Drives index.html end to end with a fake camera
    └── make-icons.mjs      Renders icons/ from an inline SVG
```

**Rule:** `[pure]` modules never touch DOM/`window` at import, so Node can test them.

---

## 4. Data Model

```js
Member    { id, name, slack /* "@alice" */, embeddings: number[][] /* 1024-d, 3–10 */,
            thumbs: string[] /* 96px dataURL */, createdAt }

Face      { box: [x, y, w, h] /* source px */, score, embedding: Float32Array }

Match     { memberId, similarity, quality, box }      // unknown faces dropped; never stored or drawn

Candidate { id, memberId, day /* "2026-10-21" */, jpeg: ArrayBuffer /* JPEG bytes */, thumb, quality, similarity,
            box, inFrame: memberId[] /* all recognized members in this photo */, seenAt,
            status: 'pending'|'dismissed' }            // max 1 pending per member per day

Lock      { memberId, day, at, via: 'shared'|'saved'|'manual'|'sniped-me' }

Settings  { mode: 'tripod', processFps: 2, idleFps: 0.5, idleAfterSec: 60,
            threshold: 0.55, margin: 0.05, minHits: 2, gapSec: 5, maxDetected: 10,
            minFacePx: 40, minCandidateFacePx: 60, tiles: 2 /* 1|2|3 */, deviceId: null /* null = default rear */,
            width: 1920, height: 1080, zoom: 1 /* 1|1.5|2 */, alert: 'off' /* off|sound */,
            reminderAt: '23:00', showLabels: true, backend: 'webgpu', debugFaces: false,
            rehearsals: [] /* P6: [{weekday, start:'19:00', end:'21:00'}] */ }
```

---

## 5. Component Interaction

### 5.1 Mode interface (extensibility)
```js
// js/modes/<name>.js
export default {
  id: 'tripod', label: 'Tripod',
  async start(ctx) {},                 // ctx = { db, settings, members, ui, device, capture, log, now }
  async tick(ctx, frame, matches) {},  // called every loop tick (matches may be [])
  async stop(ctx) {},                  // flush state
};
```
`main.js` owns camera, detector, matcher, loop, and UI shell; it hands each tick to the active mode. New modes = new file + registry entry; no loop changes.

### 5.2 Data flow (Tripod)
```
 Watch loop (main.js): every 1/processFps s (1/idleFps after idleAfterSec with no faces), busy-guarded
 ─────────────────────────────────────────────────────────────────────────────────────────────
 camera ─► <video> ─► capture.grabFrame ─► detector.detect ─► Face[]
                                                              │
                         members ─► matcher.bestMatch ────────┤  unknown → dropped
                                                              ▼
                                         Match[] ─► ui.renderLabels (members only)
                                                              │
                                        modes.tripod.tick(ctx, frame, matches)
                                                              │
                          drop matches of locked members (still matched, just ignored)
                                                              │
                              tracker.update(hits, now)  ◄── every tick
                                │                     │
                     confirmed(memberId)        ended({memberId, frame, quality, inFrame})
                                │                     │
                      beep if alert=sound      rules.decide(existing, locked, incoming)
                                                 │ discard            │ keep / replace
                                                 ▼                    ▼
                                          dispose frame     toJpegBlob ─► db.putCandidate ─► inbox badge

 Inbox: db.listCandidates(today) ─► ui.renderInbox ─► change name / dismiss / select
   Share selected (sequential, 1 photo per post):
     for each: rules.tags(c, locks) ─► share.copyText ─► share.shareFile(blob) ─► Slack
               ─► db.lock(all tagged, 'shared') ─► db.deleteCandidates(tagged members' pending)
   Save selected: share.saveFiles(blobs) ─► db.lock(tagged, 'saved')

 Clock (main.js, every 60 s): day rollover ─► db.purgeExpired + tracker reset
                              reminderAt reached & pending > 0 ─► banner + beep
 Roster: files ─► enroll.enrollFromFiles ─► detector.detect ─► db.saveMember ─► reloadMembers
         "Sniped today" / "Sniped me today" ─► db.lock(memberId, 'manual'|'sniped-me')
```

**States (main.js):** `LOADING → READY ⇄ WATCHING`; `WATCHING → PAUSED` when page hidden; Resume tap → `WATCHING`. Errors → log panel opens.

---

## 6. User Interface

### 6.1 Views
| View | Contents |
|---|---|
| Watch | Full-screen video. Only recognized, unlocked members get a small name label (`showLabels`). Strangers: nothing. Top bar: state, fps, Inbox badge, ⚙︎, 👥. Bottom: **Start/Stop**, **Dim**. |
| Dim | Black screen (OLED off = big power saving), tiny text: `Watching · 2 fps · 3 caught · post by 12 am`. Tap to wake. Recognition keeps running. |
| Inbox | Today's pending candidates, all pre-selected, countdown to midnight. Card: photo, names in frame (⚠ if locked/rehearsal window), time. Tap → full photo, **Change name**, **Not them**. Bulk: **Share selected** (one share sheet per photo, "Next" between) · **Save selected** · **Dismiss selected**. |
| Roster | Members: thumb, name, handle, photo count, today's status (open / 🔒 sniped / 🔒 sniped me). Actions: **Sniped today**, **Sniped me today**, **Undo today's lock**, Edit, Delete. **+ Add** (name, handle, 3–10 photos) with per-photo check results (§6.3). Export / Import. |
| Settings | All `Settings`, camera picker, log panel, reset. |

### 6.2 Journeys
1. **First run:** Pages URL in Safari → Share → *Add to Home Screen* → launch → models load → empty roster prompts "Add members".
2. **Tripod session:** set phone on tripod (plugged in recommended) → Start → Dim → study. Members walking by become candidates (1/member/day, best photo).
3. **Review:** tap to wake → Inbox → fix/dismiss → Share selected → for each photo: share sheet → Slack → channel → paste tags → send → Next. Shared members locked for the day.
4. **Sniped someone with the Camera app:** Roster → member → **Sniped today** → tripod stops looking for them.
5. **Someone sniped you:** Roster → **Sniped me today** (no countersnipe).
6. **Leave app / phone locks:** camera stops → PAUSED; candidates persisted → Resume.
7. **Midnight:** unshared candidates deleted; locks reset (new day).

### 6.3 Enrollment photo checks
Each photo added for a member shows ✓ used or ✗ skipped:
- ✗ **No face found**: blurry, dark, turned away.
- ✗ **Face too small**: < 80 px wide.
- ⚠ **Several faces**: largest used; confirm thumbnail.
- ⚠ **Doesn't match their other photos**: probably wrong person; remove.

### 6.4 Anti-spam (one best photo per member per day)
- **Sighting session:** starts on a member's first match; continues while matches arrive ≤ `gapSec` (5 s) apart; ends after `gapSec` unseen.
- Counts only with ≥ `minHits` (2) matches (filters one-frame false matches).
- Only the **best frame** is held: `quality = detectorScore × similarity × sqrt(faceArea / frameArea)`; face must be ≥ `minCandidateFacePx`.
- At session end, `rules.decide`: locked → discard · no pending today → keep · pending with lower quality → replace · else discard.
- Walking through frame = 1 photo; 10 passes/day = still 1 (the best); after accept = 0.

### 6.5 Staying awake
- Screen Wake Lock API (Safari 16.4+; Home Screen apps iOS 18.4+); re-acquired after app switch.
- Fallback: hidden muted looping video (NoSleep technique).
- Dim mode: screen on but black.
- If iOS locks anyway → PAUSED; nothing lost.

---

## 7. Modules: Functions & Tests

### 7.1 `settings.js` [pure]
| Function | Purpose |
|---|---|
| `DEFAULTS` | Default `Settings` |
| `validate(s)` | Clamp/coerce each field; unknown `mode` → `'tripod'` |
| `loadSettings(storage = localStorage)` | Merge over defaults; tolerate missing/corrupt/throwing storage |
| `saveSettings(s, storage = localStorage)` | Persist; swallow exceptions |

- [x] T-SET-1 [U] Empty storage → `DEFAULTS`
- [x] T-SET-2 [U] Corrupt JSON → `DEFAULTS`, no throw
- [x] T-SET-3 [U] Out-of-range clamped (threshold 5 → 1, processFps 0 → 0.2)
- [x] T-SET-4 [U] Missing new keys get defaults; unknown mode → tripod
- [x] T-SET-5 [U] Throwing storage → defaults; save doesn't throw
- [x] T-SET-6 [U] Save → load round-trips (also T-SET-3b: wrong types → defaults)

### 7.2 `rules.js` [pure]
| Function | Purpose |
|---|---|
| `dayKey(date) → "YYYY-MM-DD"` | Local calendar date (midnight rollover, rule 9) |
| `decide({existing, locked, incoming}) → 'keep'\|'replace'\|'discard'` | §6.4; replace also requires similarity ≥ existing − `SIMILARITY_GUARD` (0.03), so a sharp lookalike can't push out a real catch |
| `reminderDue(now, reminderAt, lastReminderDay)` | Once per day after `reminderAt` |
| `tags(candidate, lockedIds) → {tag: id[], flagged: id[]}` | Rule 4: everyone in frame; locked ones flagged |
| `isExpired(candidate, now)` | `candidate.day !== dayKey(now)` |
| `msUntilDeadline(now)` | Time to next midnight |
| `inRehearsalWindow(date, rehearsals, padMin = 30)` | Rule 1c flag (P6) |

- [x] T-RUL-1 [U] `dayKey` 23:59 vs 00:01 → different days
- [x] T-RUL-2 [U] `decide`: locked → discard regardless of quality
- [x] T-RUL-3 [U] `decide`: no existing → keep; existing dismissed → keep
- [x] T-RUL-4 [U] `decide`: lower existing → replace; higher/equal → discard
- [x] T-RUL-5 [U] `tags`: all inFrame members tagged; locked ones in `flagged`
- [x] T-RUL-6 [U] `isExpired` false same day, true after midnight
- [x] T-RUL-7 [U] `msUntilDeadline` at 23:00 = 3 600 000
- [x] T-RUL-8 [U] `inRehearsalWindow` true at start−30, end+30; false at start−31; weekday respected
- [x] T-RUL-9 [U] `reminderDue` once per day after `reminderAt`
- [x] T-RUL-10 [B] Rehearsal schedule edited in Settings; catches inside ±30 min get ⚠ in Inbox, outside don't. iPhone ✓

### 7.3 `modes/index.js`, `modes/tripod.js`
| Function | Purpose |
|---|---|
| `MODES` / `getMode(id)` | Registry; unknown → tripod |
| `tripod.start(ctx)` | Load today's locks + candidates; create tracker |
| `tripod.tick(ctx, frame, matches)` | Filter locked + below `minCandidateFacePx` → tracker.update → `onConfirmed` (beep) / `onEnded` (decide → JPEG → putCandidate, `inFrame` from that frame's matches) |
| `tripod.stop(ctx)` | tracker.flush → handle ended |
| `tripod.onLocksChanged(ctx)` | Refresh lock set (after share/manual lock) |

- [x] T-MOD-1 [U] `getMode('nope')` → tripod; every registered mode has `id,start,tick,stop`
- [x] T-MOD-2 [B] Fake ctx + scripted matches: one pass → exactly 1 `putCandidate`
- [x] T-MOD-3 [B] Locked member matches → no candidate, no beep
- [x] T-MOD-4 [B] Two members in same frame → candidate `inFrame` has both
- [x] T-MOD-5 [B] Lock mid-session → that session's candidate discarded
- [x] T-MOD-6 [B] Second, worse pass same day → still one candidate (best kept)
- [x] T-MOD-7 [B] Faces < `minCandidateFacePx` never become candidates (rule 3)
- [x] T-MOD-8 [B] Stop mid-sighting flushes it into a candidate
- [x] T-MOD-9 [B] Candidate saved at confirmation (still in view), then upgraded in place

### 7.4 `log.js`
| Function | Purpose |
|---|---|
| `initLog(panelEl)` | Hook console.error/warn, onerror, unhandledrejection → panel |
| `log(msg, level='info')` | Timestamped line, cap 200 |
| `toggleLog(show)` | Show/hide |

- [x] T-LOG-1 [B] Thrown error in setTimeout appears
- [x] T-LOG-2 [B] Rejected promise appears
- [x] T-LOG-3 [B] >200 lines → oldest dropped
- [x] T-LOG-5 [B] console.warn captured at warn level
- [ ] T-LOG-4 [M] iPhone: forced error visible on screen

### 7.5 `camera.js`
| Function | Purpose |
|---|---|
| `startCamera(videoEl, {facingMode, width, height, deviceId}) → {stream, width, height}` | getUserMedia, attach, return actual res |
| `stopCamera()` | Stop tracks |
| `listCameras()` | Video inputs |

- [x] T-CAM-1 [M] Laptop: webcam shows; actual resolution in status
- [x] T-CAM-2 [M] iPhone: rear camera; ≥ 1920×1080
- [x] T-CAM-3 [M] Stop → camera indicator off
- [x] T-CAM-4 [B] Permission denied → clear message, no crash (automated in `test:app`)
- [x] T-CAM-5 [M] Camera picker switches devices
- [x] T-CAM-6 [U] `cameraErrorMessage` maps each error name to readable text
- [x] T-CAM-7 [U] `zoomPlan`: camera zoom when supported, digital top-up/fallback
- [ ] T-CAM-8 [M] iPhone: Zoom 2× uses camera zoom (log: `Zoom 2×: camera 2×`); preview zooms; range improves

### 7.6 `device.js`
| Function | Purpose |
|---|---|
| `keepAwake(on)` | Wake Lock; fallback NoSleep video; re-acquire on `visibilitychange` |
| `unlockAudio()` | Resume AudioContext (inside a tap) |
| `beep(freq=880, ms=150)` | Oscillator beep |
| `setDim(on, statusText)` | Black overlay; video keeps playing (runtime state, not a setting) |

- [x] T-DEV-1 [M] iPhone Home Screen app: no auto-lock over 30 min (Auto-Lock set to 30 s to prove it)
- [x] T-DEV-2 [M] Same with Low Power Mode (record: passed)
- [x] T-DEV-3 [M] Wake lock restored after app switch + Resume
- [x] T-DEV-4 [B] Dim mode: detection still runs (candidate created) (automated in T-E2E-1)
- [ ] T-DEV-5 [M] Beep audible when `alert: sound`; silent when off

### 7.7 `detector.js`, `loop.js`
| Function | Purpose |
|---|---|
| `initDetector({backend, maxDetected, minFacePx, onProgress}) → backendUsed` | Pinned Human; face detector+mesh+description only; warm up; webgpu→webgl fallback |
| `detect(bitmap, {tiles}) → Face[]` | Stage 1 find (full frame + tiles, mesh/embedding off) → `dedupe` → stage 2 describe each face on a 2× crop |
| `humanConfig(opts)` [pure] | Config object (only face modules on) |
| `toFaces(results, minFacePx)` [pure] | Human results → `Face[]`; drop small faces |
| `tileRects(W, H, n)` [pure] | n×n grid, tiles 25% oversize so seam faces are whole in one |
| `dedupe(faces)` [pure] | Overlap > 50% of smaller box → same face; keep larger box |
| `expandRect(box, factor, W, H)` [pure] | Square crop around a face, clamped |
| `quality(face, similarity, frameW, frameH)` [pure] | `score × similarity × sqrt(area/frameArea)` |
| `loop.nextDelay(...)` / `loop.createStats()` [pure] | Adaptive fps (idle after `idleAfterSec`); rolling fps + detect ms |
| `capture.cropRect` [pure] / `capture.grabFrame` | Zoom center-crop; frame → ImageBitmap |

- [x] T-DET-1 [B] init resolves; `webgpu` or `webgl`
- [x] T-DET-2 [B] `blank.png` → `[]`
- [x] T-DET-3 [B] `group.jpg` 2×2 → ≥ 13 faces (baseline 13 of ~16); embeddings 1024-d
- [x] T-DET-4 [B] Same-person similarity > different-person
- [x] T-DET-5 [U] `quality` increases with size, score, similarity
- [x] T-DET-6 [B/M] Detect time — `tests/bench.html` on iPhone 17 (WebGPU, 1 face): tiles off 64 ms, 2×2 126 ms, 3×3 147 ms (target 2×2 ≤ 250 ms ✓)
- [x] T-DET-7 [B] Without WebGPU → webgl fallback (Firefox/WebKit headless)
- [x] T-DET-8 [U] `humanConfig`: only face modules enabled; version pinned
- [x] T-DET-9 [U] `toFaces` maps, rounds, filters, converts embeddings
- [x] T-DET-10 [U] `tileRects` covers frame; tiles overlap
- [x] T-DET-11 [U] `dedupe` merges partial duplicates; keeps neighbors
- [x] T-DET-12 [B] Distant group (50% in 1080p): 2×2 finds more than full frame (baseline full 3 → 2×2 10)
- [x] T-DET-13 [B] Tiled detect time recorded (headless software GL; informational)
- [x] T-DET-14 [U] `expandRect` centered, clamped, capped
- [x] T-SW-1 [U] `sw.js` offline list covers every js/ module and every file index.html links
- [x] T-LOOP-1..4 [U] Full rate with faces; idle rate after `idleAfterSec`; delay ≥ 0; rolling stats
- [x] T-CAP-3 [U] `cropRect` zoom 2 → centered half-size crop

### 7.8 `matcher.js` [pure]
| Function | Purpose |
|---|---|
| `cosine(a, b)` | Throws on length mismatch |
| `memberScore(embedding, member)` | Max cosine over member's embeddings (−1 if none) |
| `rank(embedding, members) → {top, runnerUp}` | Best two members regardless of threshold |
| `bestMatch(embedding, members, {threshold, margin}) → {member, similarity} \| null` | ≥ threshold and beats runner-up by ≥ margin |
| `matchFaces(faces, members, opts) → [{face, top, match}]` | Per face: match (or null) + top candidate for debug overlay |

- [x] T-MAT-1 [U] identical 1, orthogonal 0, opposite −1, scale-invariant
- [x] T-MAT-2 [U] length mismatch throws
- [x] T-MAT-3 [U] empty roster → null
- [x] T-MAT-4 [U] below threshold → null
- [x] T-MAT-5 [U] within margin → null
- [x] T-MAT-6 [U] picks highest; best of member's photos; 0-embedding member ignored
- [x] T-MAT-7 [B] Real faces: 2 enrolled people recognized (0.70, 0.72), stranger unmatched
- [x] T-MAT-8 [U] `matchFaces` returns top even when unmatched; skips faces without embedding

### 7.9 `tracker.js` [pure]
| Function | Purpose |
|---|---|
| `createTracker({minHits, gapSec, onDispose})` | Frames are opaque, shared between members in a tick, reference-counted; `onDispose(frame)` once nothing holds it |
| `tracker.update(hits, now) → {confirmed: id[], ended: [{memberId, frame, quality, meta, hits, start, end}]}` | `hits = [{memberId, quality, frame, meta}]`; call every tick. Tracker owns every frame passed in; each `ended` entry hands one reference to the caller |
| `tracker.release(frame)` | Caller is done with an `ended` frame |
| `tracker.drop(memberId)` | End + dispose a member's session silently (locked mid-session) |
| `tracker.flush()` / `tracker.reset()` | End all (reported) / dispose all |

- [x] T-TRK-1 [U] 1 hit then gap → not reported, frame disposed
- [x] T-TRK-2 [U] ≥ minHits → `confirmed` once, at minHits-th hit
- [x] T-TRK-3 [U] Ended session returns highest-quality frame; others disposed
- [x] T-TRK-4 [U] Gap > gapSec → two sessions
- [x] T-TRK-5 [U] Two members independent; shared frame disposed only after both release
- [x] T-TRK-6 [U] `drop`, `flush`, `reset` behave
- [x] T-TRK-7 [U] 400-tick random stream: every frame disposed exactly once (no leaks)
- [x] T-TRK-8 [U] `improved` reports best frame at confirmation and on each improvement (photo saved while person still in view)

### 7.10 `capture.js`
| Function | Purpose |
|---|---|
| `grabFrame(videoEl, zoom=1) → ImageBitmap` | Center-crop by zoom |
| `cropFace(bitmap, box, pad=0.3, size=96) → dataURL` | Thumbnail, clamped |
| `toJpegBlob(bitmap, q=0.9)` | JPEG (OffscreenCanvas, canvas fallback) |

- [x] T-CAP-1 [B] JPEG type, size > 0, dims preserved (via T-DB-9)
- [ ] T-CAP-2 [B] Edge box crop OK; 96×96

### 7.11 `enroll.js`
| Function | Purpose |
|---|---|
| `enrollFromFiles(files) → [{name, status, note, embedding?, thumb?}]` | §6.3 checks (photos shrunk to 1600 px; tiles off) |
| `evaluateFaces(faces)` [pure] | Used/skipped verdict + note |
| `selfConsistency(embeddings) → {outlierIndex \| null}` [pure] | Flag photo unlike the others |

- [x] T-ENR-1 [B] Single clear face → used
- [x] T-ENR-2 [B] `blank.png` → "No face found"
- [x] T-ENR-3 [B] Group photo → largest + "Several faces"
- [x] T-ENR-4 [U] `selfConsistency` flags outlier
- [ ] T-ENR-5 [M] iPhone HEIC photos work
- [x] T-ENR-6 [U] `evaluateFaces`: no face / too small / unclear skipped; largest of several used

### 7.12 `db.js`
| Function | Purpose |
|---|---|
| `openDb()` | Stores `members`, `candidates`, `locks` |
| `listMembers` / `saveMember` / `deleteMember` | Delete also removes member's candidates + locks |
| `listCandidates(day)` / `getCandidate(memberId, day)` / `putCandidate(c)` / `deleteCandidates(ids)` / `dismissCandidates(ids)` / `candidateBlob(c)` | Inbox; photo stored as ArrayBuffer (portable across IndexedDB implementations) |
| `purgeExpired(today)` | Delete candidates with `day < today` (rule 9) |
| `lock(memberIds, day, via)` / `unlock(memberId, day)` / `listLocks(day)` | Daily lock |
| `exportJson()` / `importJson(str, {mode})` | Roster only; `merge` (default) via `rostersync.mergeRosters`, returns report; `replace` makes it identical |
| `validateMember(obj) → string[]` [pure] | Errors |

- [x] T-DB-1 [B] Member CRUD; delete cascades
- [x] T-DB-2 [B] Export → clear → import equal
- [x] T-DB-3 [B] Merge import twice → no duplicates
- [x] T-DB-4 [U] `validateMember` rejects bad records
- [x] T-DB-5 [B] Malformed import → error, DB unchanged
- [x] T-DB-10 [U] `normalizeSlack`
- [x] T-DB-6 [B] `putCandidate` same member+day overwrites
- [x] T-DB-7 [B] `lock` → listed that day, not next; `unlock` removes
- [x] T-DB-8 [B] `purgeExpired` removes yesterday's, keeps today's
- [x] T-DB-9 [B] Candidate photo round-trips as a real JPEG
- [x] T-DB-11 [B] `dismissCandidates` marks dismissed, drops photo; dismissed not listed
- [x] T-DB-12 [B] `reassignCandidate` moves catch, replaces target's pending one
- [x] T-DB-13 [B] `deleteCandidatesFor` removes only named members' catches that day
- [x] T-DB-14 [B] Merge import: same person enrolled elsewhere (different id, name in other case) gains photos, keeps local id
- [x] T-SYNC-1..10 [U] `mergeRosters`: id match, name match, idempotent re-import, two-way growth, handle fill, name conflict kept separate, ids authoritative, 30-photo cap, `nameKey`

### 7.13 `share.js`, `inbox.js`
| Function | Purpose |
|---|---|
| `tagText(members)` [pure] | `"🎯 Sniped @alice @bob"`; name if no handle |
| `snipeFilename(date, names)` [pure] | `snipe-YYYY-MM-DD-HHMMSS-alice-bob.jpg` |
| `copyText(text)` | Clipboard (started synchronously in the tap, before share) |
| `shareFile(file, text) → 'shared'\|'cancelled'\|'downloaded'` | One photo per share (rule 5); download fallback without a share sheet |
| `saveFiles(files)` | iPhone: share sheet *Save N Images*. Laptop: downloads |
| `inbox.showInbox()` | Today's pending catches, new ones preselected, countdown, ⚠ flags (locked members in photo, rehearsal window) |
| `inbox` share flow | Step per photo: tags everyone in it not yet locked; after sharing locks all tagged + deletes their other catches; later photos of tagged members skipped |
| `inbox` detail | Full photo, "Wrong person? Change to" (`db.reassignCandidate`), "Not them" (dismiss) |
| `roster` today actions | Status (open / caught / sniped / sniped you); **Sniped today**, **Sniped me today**, **Reset today** (unlock + drop today's photo) |

- [x] T-SHR-1 [U] `tagText` handles/no handles/empty
- [x] T-SHR-2 [U] `snipeFilename` format, padded, slugged
- [x] T-SHR-3 [B] Share 3 selected (fake iPhone sheet): 2 posts, 1 photo each, photo only (no text), Alice's photo tags @alice @bob, Bob's own photo skipped, all 3 locked `shared`, badge clears. iPhone: photo reached Slack after P5.1 fix; tags must be typed (see §1 Slack tags)
- [x] T-SHR-4 [M] Tags paste as plain text, not mentions → P7
- [x] T-SHR-5 [B] Laptop: Share downloads `…-cara.jpg`, copies tags, locks `saved`
- [x] T-SHR-6 [B] Cancel → candidate stays, nobody locked
- [x] T-SHR-7 [B] Save selected → one sheet with 3 photos; locked `saved`

### 7.14 `ui.js`
| Function | Purpose |
|---|---|
| `mapBox(box, srcW, srcH, viewW, viewH)` [pure] | Source → screen (`object-fit: cover`) |
| `showView` / `setStatus` / `toast` / `progress` / `banner` | Shell |
| `renderLabels(canvas, matches, members, srcDims)` | Unlocked members only |
| `renderInbox(candidates, members, locks, handlers)` | Grid, countdown, ⚠ flags, change name, bulk, share stepper |
| `renderRoster(members, locks, handlers)` / `renderEnrollResults(results)` | Roster + lock actions |
| `renderSettings(s, onChange)` | Settings |

- [x] T-UI-1 [U] `mapBox` identity when aspects match
- [x] T-UI-2 [U] `mapBox` 16:9 in 9:16 offsets x correctly
- [ ] T-UI-3 [M] Labels on members only; aligned; strangers nothing
- [x] T-UI-4 [M] Buttons ≥ 44 px; no horizontal scroll
- [x] T-UI-5 [B] Change name → candidate moves to new member, replacing their pending one
- [x] T-UI-6 [B] Roster today actions update status, locks, and the running mode

### 7.15 `main.js`
| Function | Purpose |
|---|---|
| `boot()` | log → settings → db → purgeExpired → members → detector → UI → READY |
| `startWatch()` | (tap) unlockAudio → camera → keepAwake → `mode.start` → loop → WATCHING |
| `stopWatch()` | `mode.stop` → camera off → keepAwake off → READY |
| `tick()` | grab → detect → match → labels → `mode.tick`; adaptive fps |
| `clock()` | Every 60 s: rollover → purge + `mode.onLocksChanged`; reminder banner/beep |
| `shareSelected(ids)` / `saveSelected(ids)` / `dismissSelected(ids)` | Inbox actions → lock + cleanup |
| `lockMember(id, via)` / `unlockMember(id)` | Roster actions |
| `reloadMembers()` / `onVisibility()` | Roster refresh; PAUSED/Resume |

- [x] T-MAIN-1 [M] Boot on iPhone → READY (detector WebGPU, 0.2 s warm)
- [x] T-MAIN-2 [B] Loop never overlaps; idle fps after idleAfterSec (automated: T-MAIN-2, T-APP-13)
- [ ] T-MAIN-3 [M] Background → PAUSED → Resume; candidates intact
- [x] T-MAIN-4 [B] Stop mid-session → candidate still produced (automated)
- [x] T-MAIN-5 [B] Clock faked to 23:59:48 (`?clockOffset`) → candidates purged after midnight; badge clears
- [x] T-MAIN-6 [B] Clock faked to 23:00 with pending → banner (+ beep)

### 7.16 App-level automated checks (`npm run test:app`, Playwright, fake camera, iPhone-size viewport)
- [x] T-APP-1 Boots to Ready with no errors
- [x] T-APP-2 Start → Watching; live video; resolution in log
- [x] T-APP-3 Dim covers screen; video keeps playing underneath; tap wakes
- [x] T-APP-4 Settings form renders all groups; edits validated + persisted
- [x] T-APP-5 Camera setting change restarts camera, keeps watching
- [x] T-APP-6 Log panel opens; shows camera line
- [x] T-APP-7 Stop → Ready; camera released
- [x] T-APP-8 Settings persist across reload; Reset restores defaults
- [x] T-APP-9 No horizontal scroll in any view at 393 px width
- [x] T-APP-10 All visible buttons ≥ 44 px
- [x] T-APP-11 Watch loop runs; status shows fps, detect ms, faces, backend
- [x] T-APP-12 Face video as camera (Chromium) → detected; debug overlay box drawn and aligned
- [x] T-APP-13 No faces → idle rate after `idleAfterSec`
- [x] T-APP-14 Add member from 4 photos: 3 used, blank skipped; row shows `@handle · 3 photos`
- [x] T-APP-15 Editor shows thumbnails and skipped-photo reason
- [x] T-APP-16 Export → second device that enrolled the same person separately imports → 1 member, 4 photos; re-import adds nothing
- [ ] T-SYNC-11 [M] Laptop → phone: enroll/add photos on laptop, export, import on phone; member photo counts grow, catches/locks kept
- [x] T-APP-17 Delete member (confirm) removes them
- [x] T-APP-18 Enrolled member on camera → green name label, `known 1`; strangers draw nothing
- [x] T-APP-19 Inbox lists catches, all preselected, countdown, "with Bob" on a shared photo
- [x] T-APP-20 Dismiss selected removes catches without locking
- [x] T-APP-21 Inbox updates live on a new catch; replaced (better) photo shows
- [x] T-APP-22 Member stays in view → badge 1 without stopping the camera (P6 fix: was only on stop). iPhone ✓
- [x] T-APP-23 Manifest (standalone, start URL, 2 icons) + iOS icon served. iPhone: home-screen icon ✓
- [x] T-APP-24 Works offline after first load (Chromium: service worker + cached models). iPhone: Airplane Mode ✓
- [x] T-APP-25 Locked member → gray "🔒 Name · sniped today" label, no new photo; Reset today restores catching
- [x] T-APP-26 Zoom without camera zoom → digital: preview scales, face still recognized

---

## 8. End-to-End, Power & Accuracy Tests

- [x] T-E2E-1 [B] Fake camera loop (A+B 6 s, empty 8 s): one pass → 1 candidate each; badge 2; dim text "2 caught · post by 12 am". iPhone: caught on device ✓
- [x] T-E2E-2 [B] Further passes → still 1 per member. iPhone: stayed at 1 on re-entry ✓
- [x] T-E2E-3 [B] Lock member → later passes → nothing (next-day part: T-MAIN-5 + T-RUL-1)
- [x] T-E2E-4 [B] "Sniped today" in Roster → tripod mode ignores member (T-UI-6 + T-MOD-3)
- [ ] T-E2E-5 [M] 15 min strangers only → 0 candidates, nothing drawn
- [x] T-E2E-6 [B] Two members together → candidates list both; sharing one locks both and removes the other's pending (T-SHR-3)
- [ ] T-E2E-7 [M] **Power:** 60 min, dim, unplugged → battery drop ____ % (goal ≤ 12 %); not hot
- [ ] T-E2E-8 [M] 2-hour tripod session plugged in → no crash, candidates intact
- [ ] T-E2E-9 [M] Max recognition distance 1× ____ m, 2× ____ m (P2 detection only, poor light: ~15–20 ft, tiles off ≈ 2×2, faces down to ~30 px)
- [ ] T-E2E-10 [M] Full flow: catch → Inbox → Share selected → Slack posts with tags
- [ ] T-E2E-11 [M] Fresh install via Add to Home Screen → enroll → watch → share

**Threshold tuning (`tests/tune.html`, laptop):** reads `fixtures/manifest.json` (people/<name>/ = known, strangers/ = non-members); enrolls first 3 photos per person, scores the rest by best match (as the app does); suggests the lowest threshold with ≤ 0.1% false matches.
**Test people:** you + a friend are enough for every functional test. Accuracy against strangers is measured with ~30 sample strangers (fixtures) plus T-E2E-5 in a busy public place. For tuning, put 6–10 varied photos each in `tests/fixtures/people/<name>/`, re-run `tools/fetch-fixtures.sh`, open tune.html.
- [x] T-TUNE-1a Fixture baseline (3 sample people, 30 strangers): member's own face mean 0.715 (min 0.654); others mean 0.471 (max 0.631) → threshold 0.64, margin 0.05
- [ ] T-TUNE-1b With your + friend's photos: own-face min ____ · others max ____ · threshold ____
- [x] T-TUNE-2..6 [U] Pair splitting, rates, suggestion, histogram, member-level scoring

---

## 9. Phases & Exit Criteria

| Phase | Build | Exit criteria |
|---|---|---|
| **P0 Setup** | git, GitHub repo + Pages, `package.json`, `serve.sh`, `harness.js`, `browser.html`, `.gitignore`, hello `index.html` | Hello page on iPhone via Pages HTTPS; `npm test` runs |
| **P1 Shell** | `index.html`, `style.css`, `settings.js`, `log.js`, `camera.js`, `device.js`, `ui.js` (views, status, `mapBox`) | T-SET, T-LOG, T-CAM, T-DEV-1/2/3/5, T-UI-1/2/4 |
| **P2 Detection** | `detector.js`, `bench.html`, adaptive loop | T-DET, T-MAIN-2 |
| **P3 Recognition** | `matcher.js`, `db.js` (members), `enroll.js`, Roster, `tune.html`, labels | T-MAT, T-DB-1..5, T-ENR, T-TUNE-1, T-UI-3 |
| **P4 Catching** | `rules.js`, `tracker.js`, `capture.js`, `modes/`, `db.js` (candidates, locks, purge), dim, clock | T-RUL, T-TRK, T-CAP, T-MOD, T-DB-6..9, T-DEV-4, T-E2E-1..6, T-MAIN-4/5/6 |
| **P5 Inbox + Share** | `share.js`, Inbox, Roster lock actions | T-SHR, T-UI-5/6, T-E2E-10 |
| **P6 Polish** | manifest, icons, `sw.js`, rehearsal schedule; fixes: live save while in view, live Inbox, share photo-only (zoom + export/import were built in P1/P3) | T-APP-21..24, T-RUL-10, T-SW-1; device: T-E2E-7/8/9/11, T-MAIN-3 |
| **P7 Optional** | Pi watcher, Slack auto-post, more modes | Separate plan |

---

## 10. Dev Workflow

- **Laptop:** `./tools/serve.sh` → `http://localhost:8000`, `/tests/browser.html`, `/tests/bench.html`, `/tests/tune.html`.
- **Unit tests:** `npm test` (Node).
- **Browser tests:** `npm run test:browser` (tests/browser.html in Chromium, Firefox, WebKit via Playwright; dev-only, not deployed).
- **App checks:** `npm run test:app` (drives index.html with a fake camera; `SHOT_DIR=… ` saves screenshots).
- **iPhone:** `git push` → Pages (~1 min) → reload. Debug via on-screen log. Bump SW cache version each deploy.
- **Done per function:** all its tests `[x]` here, committed.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Small/distant faces | Zoom center-crop; record range (T-E2E-9) |
| Battery drain | 2 fps, idle fps, dim; measured (T-E2E-7) |
| iOS auto-lock | NoSleep fallback; PAUSED; candidates persisted |
| WebGPU quirks | webgl fallback |
| Slack drops shared text | Tags copied to clipboard first |
| Human CDN/model changes | Pinned version; SW caches models |
| False matches (lookalike strangers) | Threshold 0.64 + margin + ≥ 2 hits per sighting; user confirms in Inbox. **P4:** a later, higher-quality pass must not replace a pending candidate with a lower similarity (guard in `rules.decide`). |
| Rule violations (same event, classroom, rehearsal) | Can't auto-detect; time shown + rehearsal flag; user verifies before sharing |
| Biometric data exposure | No fixtures/exports in repo; export files sensitive; enroll only consenting members (rule 10) |

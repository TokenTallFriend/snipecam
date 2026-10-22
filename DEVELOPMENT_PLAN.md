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
| Backend | `webgpu`, fallback `webgl`. |
| Hosting | GitHub Pages (public repo, HTTPS). Dev on `localhost`. |
| Storage | IndexedDB per device: roster, candidates (JPEG), daily lock log. Settings in localStorage. **No face data in the repo.** |
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
├── sw.js                   Service worker: cache app + models (P6)
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
│   ├── db.js               IndexedDB: members, candidates, locks; export/import
│   ├── share.js            Tag text, single-file share, clipboard, download
│   └── ui.js               Views, labels, inbox, roster, settings
├── tests/
│   ├── browser.html        Runs tests/browser/*.test.js, pass/fail by test ID
│   ├── harness.js          Minimal test()/assert for browser tests
│   ├── bench.html          Detector timing benchmark
│   ├── tune.html           Threshold tuning (labeled folder → similarity stats)
│   ├── unit/               *.test.js for [pure] modules
│   ├── browser/            *.test.js needing DOM/camera/IndexedDB/Human
│   └── fixtures/           GITIGNORED. people/<name>/*.jpg, blank.png, group.jpg
└── tools/
    ├── serve.sh            python3 -m http.server 8000
    ├── fetch-fixtures.sh   Sample faces (Human repo, MIT) + fake-camera video → tests/fixtures/
    ├── testlib.mjs         Playwright helpers (throwaway server, engines with fake camera)
    ├── test-browser.mjs    Runs tests/browser.html in Chromium/Firefox/WebKit
    └── test-app.mjs        Drives index.html end to end with a fake camera
```

**Rule:** `[pure]` modules never touch DOM/`window` at import, so Node can test them.

---

## 4. Data Model

```js
Member    { id, name, slack /* "@alice" */, embeddings: number[][] /* 1024-d, 3–10 */,
            thumbs: string[] /* 96px dataURL */, createdAt }

Face      { box: [x, y, w, h] /* source px */, score, embedding: Float32Array }

Match     { memberId, similarity, quality, box }      // unknown faces dropped; never stored or drawn

Candidate { id, memberId, day /* "2026-10-21" */, blob /* JPEG */, thumb, quality, similarity,
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
| `decide({existing, locked, incoming}) → 'keep'\|'replace'\|'discard'` | §6.4 |
| `tags(candidate, lockedIds) → {tag: id[], flagged: id[]}` | Rule 4: everyone in frame; locked ones flagged |
| `isExpired(candidate, now)` | `candidate.day !== dayKey(now)` |
| `msUntilDeadline(now)` | Time to next midnight |
| `inRehearsalWindow(date, rehearsals, padMin = 30)` | Rule 1c flag (P6) |

- [ ] T-RUL-1 [U] `dayKey` 23:59 vs 00:01 → different days
- [ ] T-RUL-2 [U] `decide`: locked → discard regardless of quality
- [ ] T-RUL-3 [U] `decide`: no existing → keep; existing dismissed → keep
- [ ] T-RUL-4 [U] `decide`: lower existing → replace; higher/equal → discard
- [ ] T-RUL-5 [U] `tags`: all inFrame members tagged; locked ones in `flagged`
- [ ] T-RUL-6 [U] `isExpired` false same day, true after midnight
- [ ] T-RUL-7 [U] `msUntilDeadline` at 23:00 = 3 600 000
- [ ] T-RUL-8 [U] `inRehearsalWindow` true at start−30, end+30; false at start−31

### 7.3 `modes/index.js`, `modes/tripod.js`
| Function | Purpose |
|---|---|
| `MODES` / `getMode(id)` | Registry; unknown → tripod |
| `tripod.start(ctx)` | Load today's locks + candidates; create tracker |
| `tripod.tick(ctx, frame, matches)` | Filter locked + below `minCandidateFacePx` → tracker.update → `onConfirmed` (beep) / `onEnded` (decide → JPEG → putCandidate, `inFrame` from that frame's matches) |
| `tripod.stop(ctx)` | tracker.flush → handle ended |
| `tripod.onLocksChanged(ctx)` | Refresh lock set (after share/manual lock) |

- [ ] T-MOD-1 [U] `getMode('nope')` → tripod; every registered mode has `id,start,tick,stop`
- [ ] T-MOD-2 [B] Fake ctx + scripted matches: one pass → exactly 1 `putCandidate`
- [ ] T-MOD-3 [B] Locked member matches → no candidate, no beep
- [ ] T-MOD-4 [B] Two members in same frame → candidate `inFrame` has both
- [ ] T-MOD-5 [B] Lock mid-session → that session's candidate discarded

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
- [ ] T-DEV-4 [M] Dim mode: detection still runs (candidate created)
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
- [ ] T-DET-6 [B/M] Detect time — `tests/bench.html` on iPhone: tiles off ____ ms, 2×2 ____ ms, 3×3 ____ ms (target 2×2 ≤ 250 ms)
- [x] T-DET-7 [B] Without WebGPU → webgl fallback (Firefox/WebKit headless)
- [x] T-DET-8 [U] `humanConfig`: only face modules enabled; version pinned
- [x] T-DET-9 [U] `toFaces` maps, rounds, filters, converts embeddings
- [x] T-DET-10 [U] `tileRects` covers frame; tiles overlap
- [x] T-DET-11 [U] `dedupe` merges partial duplicates; keeps neighbors
- [x] T-DET-12 [B] Distant group (50% in 1080p): 2×2 finds more than full frame (baseline full 3 → 2×2 10)
- [x] T-DET-13 [B] Tiled detect time recorded (headless software GL; informational)
- [x] T-DET-14 [U] `expandRect` centered, clamped, capped
- [x] T-LOOP-1..4 [U] Full rate with faces; idle rate after `idleAfterSec`; delay ≥ 0; rolling stats
- [x] T-CAP-3 [U] `cropRect` zoom 2 → centered half-size crop

### 7.8 `matcher.js` [pure]
| Function | Purpose |
|---|---|
| `cosine(a, b)` | Throws on length mismatch |
| `memberScore(embedding, member)` | Max cosine over member's embeddings (−1 if none) |
| `bestMatch(embedding, members, {threshold, margin}) → {member, similarity} \| null` | ≥ threshold and beats runner-up by ≥ margin |

- [ ] T-MAT-1 [U] identical 1, orthogonal 0, opposite −1
- [ ] T-MAT-2 [U] length mismatch throws
- [ ] T-MAT-3 [U] empty roster → null
- [ ] T-MAT-4 [U] below threshold → null
- [ ] T-MAT-5 [U] within margin → null
- [ ] T-MAT-6 [U] picks highest; 0-embedding member ignored

### 7.9 `tracker.js` [pure]
| Function | Purpose |
|---|---|
| `createTracker({minHits, gapSec, onDispose})` | Frames are opaque refs; `onDispose(ref)` for every discarded frame |
| `tracker.update(hits, now) → {confirmed: id[], ended: [{memberId, frame, quality, meta, hits, start, end}]}` | `hits = [{memberId, quality, frame, meta}]`; call every tick |
| `tracker.drop(memberId)` | End + dispose a member's session (lock mid-session) |
| `tracker.flush(now)` / `tracker.reset()` | End all / dispose all |

- [ ] T-TRK-1 [U] 1 hit then gap → not reported, frame disposed
- [ ] T-TRK-2 [U] ≥ minHits → `confirmed` once, at minHits-th hit
- [ ] T-TRK-3 [U] Ended session returns highest-quality frame; others disposed
- [ ] T-TRK-4 [U] Gap > gapSec → two sessions
- [ ] T-TRK-5 [U] Two members independent
- [ ] T-TRK-6 [U] `drop`, `flush`, `reset` behave; no leaks
- [ ] T-TRK-7 [U] Every frame returned once or disposed once

### 7.10 `capture.js`
| Function | Purpose |
|---|---|
| `grabFrame(videoEl, zoom=1) → ImageBitmap` | Center-crop by zoom |
| `copyFrame(bitmap)` | Independent copy |
| `cropFace(bitmap, box, pad=0.3, size=96) → dataURL` | Thumbnail, clamped |
| `toJpegBlob(bitmap, q=0.9)` | JPEG |

- [ ] T-CAP-1 [B] JPEG type, size > 0, dims preserved
- [ ] T-CAP-2 [B] Edge box crop OK; 96×96
- [ ] T-CAP-4 [B] copy survives closing original

### 7.11 `enroll.js`
| Function | Purpose |
|---|---|
| `enrollFromFiles(files) → {embeddings, thumbs, results: [{name, status, note}]}` | §6.3 checks |
| `selfConsistency(embeddings) → {outlierIndex \| null}` [pure] | Flag photo unlike the others |

- [ ] T-ENR-1 [B] Single clear face → used
- [ ] T-ENR-2 [B] `blank.png` → "No face found"
- [ ] T-ENR-3 [B] Group photo → largest + "Several faces"
- [ ] T-ENR-4 [U] `selfConsistency` flags outlier
- [ ] T-ENR-5 [M] iPhone HEIC photos work

### 7.12 `db.js`
| Function | Purpose |
|---|---|
| `openDb()` | Stores `members`, `candidates`, `locks` |
| `listMembers` / `saveMember` / `deleteMember` | Delete also removes member's candidates + locks |
| `listCandidates(day)` / `getCandidate(memberId, day)` / `putCandidate(c)` / `deleteCandidates(ids)` / `dismissCandidates(ids)` | Inbox |
| `purgeExpired(today)` | Delete candidates with `day < today` (rule 9) |
| `lock(memberIds, day, via)` / `unlock(memberId, day)` / `listLocks(day)` | Daily lock |
| `exportJson()` / `importJson(str, {mode})` | Roster only |
| `validateMember(obj) → string[]` [pure] | Errors |

- [ ] T-DB-1 [B] Member CRUD; delete cascades
- [ ] T-DB-2 [B] Export → clear → import equal
- [ ] T-DB-3 [B] Merge import twice → no duplicates
- [ ] T-DB-4 [U] `validateMember` rejects bad records
- [ ] T-DB-5 [B] Malformed import → error, DB unchanged
- [ ] T-DB-6 [B] `putCandidate` same member+day overwrites
- [ ] T-DB-7 [B] `lock` → listed that day, not next; `unlock` removes
- [ ] T-DB-8 [B] `purgeExpired` removes yesterday's, keeps today's
- [ ] T-DB-9 [B] Candidate blob survives reload

### 7.13 `share.js`
| Function | Purpose |
|---|---|
| `tagText(members, flagged)` [pure] | `"🎯 Sniped @alice @bob"`; name if no handle; flagged excluded |
| `snipeFilename(date, names)` [pure] | `snipe-YYYY-MM-DD-HHMMSS-alice-bob.jpg` |
| `copyText(text) → bool` | Clipboard (in tap, before share) |
| `shareFile(blob, text) → 'shared'\|'cancelled'\|'unsupported'` | One photo per share (rule 5) |
| `saveFiles(blobs)` | iPhone: share sheet *Save Images*. Laptop: downloads |

- [ ] T-SHR-1 [U] `tagText` handles/no handles/flagged/empty
- [ ] T-SHR-2 [U] `snipeFilename` format, padded, slugged
- [ ] T-SHR-3 [M] iPhone: Share selected (3) → 3 sequential sheets → 3 Slack posts
- [ ] T-SHR-4 [M] Tags pasteable after each share
- [ ] T-SHR-5 [M] Laptop: Save → Downloads
- [ ] T-SHR-6 [M] Cancel → candidate stays, not locked; sequence continues/aborts cleanly

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
- [ ] T-UI-5 [M] Change name → candidate moves to new member (1/day respected)
- [ ] T-UI-6 [M] Roster lock/unlock buttons reflect state

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

- [ ] T-MAIN-1 [M] Boot on iPhone → READY (record: ____ s cold / ____ s warm)
- [x] T-MAIN-2 [B] Loop never overlaps; idle fps after idleAfterSec (automated: T-MAIN-2, T-APP-13)
- [ ] T-MAIN-3 [M] Background → PAUSED → Resume; candidates intact
- [ ] T-MAIN-4 [M] Stop mid-session → candidate still produced
- [ ] T-MAIN-5 [M] Clock faked to 23:59:30 → candidates purged after midnight; locks reset
- [ ] T-MAIN-6 [M] Clock faked to 23:00 with pending → banner + beep

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

---

## 8. End-to-End, Power & Accuracy Tests

- [ ] T-E2E-1 [M] Member walks through once → exactly 1 candidate
- [ ] T-E2E-2 [M] Member passes 5× → still 1 candidate, best photo
- [ ] T-E2E-3 [M] Share member → later passes → nothing; next day → new candidate
- [ ] T-E2E-4 [M] "Sniped today" in Roster → member ignored rest of day
- [ ] T-E2E-5 [M] 15 min strangers only → 0 candidates, nothing drawn
- [ ] T-E2E-6 [M] Two members together → candidates tag both; sharing one locks both and removes the other's pending
- [ ] T-E2E-7 [M] **Power:** 60 min, dim, unplugged → battery drop ____ % (goal ≤ 12 %); not hot
- [ ] T-E2E-8 [M] 2-hour tripod session plugged in → no crash, candidates intact
- [ ] T-E2E-9 [M] Max recognition distance 1× ____ m, 2× ____ m
- [ ] T-E2E-10 [M] Full flow: catch → Inbox → Share selected → Slack posts with tags
- [ ] T-E2E-11 [M] Fresh install via Add to Home Screen → enroll → watch → share

**Threshold tuning (`tests/tune.html`, laptop):** pick `fixtures/people/` → same/different-person histograms → suggested threshold + margin.
- [ ] T-TUNE-1 Same-person mean ____ · Diff-person mean ____ · threshold ____ · margin ____

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
| **P6 Polish** | manifest, icons, `sw.js`, zoom, export/import UI, rehearsal flag | T-E2E-7/8/9/11, T-MAIN-1/3, T-RUL-8 |
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
| Rule violations (same event, classroom, rehearsal) | Can't auto-detect; time shown + rehearsal flag; user verifies before sharing |
| Biometric data exposure | No fixtures/exports in repo; export files sensitive; enroll only consenting members (rule 10) |

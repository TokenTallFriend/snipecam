# SnipeCam

On-device face recognition for the club sniping game. A phone or laptop on a tripod watches, recognizes club members, keeps the best photo of each member per day, and lets you batch-share them to Slack.

All processing happens in the browser. No video or face data leaves the device, and none is stored in this repo.

- **App:** https://tokentallfriend.github.io/snipecam/
- **Plan & test checklist:** [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)

## Development

```sh
./tools/serve.sh      # app at http://localhost:8000
npm test              # unit tests (Node)
```

Browser tests: http://localhost:8000/tests/browser.html

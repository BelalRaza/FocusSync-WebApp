# FocusSync Web

An interview demo of FocusSync, adapted from the React Native app at `Desktop/appDev/FocusSync`. The mobile project is preserved separately.

Local demo: http://127.0.0.1:5173

The app runs locally with a standard Cloudflare Worker configuration in `wrangler.json`. The database identifier is a local development placeholder. Configure your own Cloudflare database identifier before deploying to your own hosting.

## Present in two minutes

1. Open the demo and choose **Create a session**.
2. Enter your name and a room name. Select **Try a 1-minute demo preset**.
3. Create the room. Select **Open companion tab**, then join as **Demo guest**.
4. Return to the host tab and start the timer. Both tabs show the same countdown.
5. Pause and resume. The guest can follow the timer but cannot control it.
6. Refresh the host tab to demonstrate session recovery.
7. After the minute finishes, choose **Prepare a break**, then **Start break**.
8. End the room for everyone, or leave and rejoin from **Recent sessions**.

For a longer presentation, use Pomodoro (25 / 5), custom durations, or the open-ended count-up mode. Your session intention is private to this browser. Device sound preferences and session history are remembered locally.

## Run locally

Node 22.13 or newer is required. Validated with Node 25.6.1. Double-click `Launch FocusSync.command` on this Mac, or use:

```sh
npm ci
npm run build
npm run db:local
npm run dev
```

Open http://127.0.0.1:5173. The launch script prints the address. Keep its terminal open while presenting locally. Press Control-C to stop.

The local database is stored on this machine. A local room code must be joined at the same local site. For another device to join, deploy the app to your chosen host.

## What works

- Create a named room and join with a six-character code or invite link.
- Host-only start, pause, resume, reset, settings, focus/break selection, and end.
- Server timestamps keep countdowns consistent between clients and across reloads.
- Pomodoro, custom focus/break durations, and a genuine open-ended count-up timer.
- Explicit focus-to-break handoff, completion count, and a gentle completion chime.
- Participant presence, room activity, automatic reconnect, and recent rooms.
- A companion tab uses a separate member credential, allowing a host/member demonstration in one browser.
- Input validation, server-enforced roles, revision checks, idempotent action delivery, and atomic state writes.

## Implementation notes for the interview

This web port uses React with Vinext and a Cloudflare Worker backed by D1. It adapts the original host-owned event state machine. It uses HTTP polling every 1.2 seconds for shared state instead of the mobile prototype's WebSocket transport. The local countdown renders from absolute server timestamps; polling does not drive timer ticks. Presence is refreshed every 15 seconds and shows Away after 45 seconds without a heartbeat.

The server stores the authoritative room state in D1. A compare-and-swap revision check prevents concurrent actions from silently overwriting one another. Private bearer credentials represent host/member access and are omitted from public room state. Host credentials are remembered on the creating browser; there is no account-based host transfer or cross-device host recovery.

Breaks start explicitly. Sound requires a browser interaction and is subject to browser audio policies. Controls are disabled while reconnecting; actions are not queued offline. Recent-session history and private intentions live on this device. Rooms are not shared with the separate mobile backend. This is a working interview prototype, not a claim of production-scale load testing.

## Verification

```sh
npm run check
npm test
npm run build
# With the local server running:
node tests/api-smoke.mjs
```

The core suite covers configuration, host authorization, start/pause/resume/reset, duplicate delivery, stale revisions, precise completion, explicit breaks, open-ended timing, rejoin, and ended rooms. HTTP checks exercise the deployed request handlers against the local D1 service. Browser checks cover the host/member flow, synchronized pause/resume, reload recovery, round completion, and responsive layout.

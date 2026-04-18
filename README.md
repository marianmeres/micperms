# @marianmeres/micperms

[![NPM](https://img.shields.io/npm/v/@marianmeres/micperms)](https://www.npmjs.com/package/@marianmeres/micperms)
[![JSR](https://jsr.io/badges/@marianmeres/micperms)](https://jsr.io/@marianmeres/micperms)
[![License](https://img.shields.io/npm/l/@marianmeres/micperms)](LICENSE)

Framework-agnostic microphone permission lifecycle manager. Detects platform
(browser, PWA, iOS/Android WebView), checks and requests permission, tracks state
reactively, and supports native bridge for opening app settings.

Does **not** own MediaStreams — when `getUserMedia` is called to probe permission,
all tracks are stopped immediately. Your app handles its own stream acquisition once
permission is `granted`.

## Installation

```bash
# Deno / JSR
deno add jsr:@marianmeres/micperms

# npm
npm install @marianmeres/micperms
```

## Usage

```typescript
import { createMicPerms } from "@marianmeres/micperms";

const mic = createMicPerms();

// Reactive subscription (Svelte $store compatible)
mic.subscribe((state) => {
	console.log(state.status); // "unknown" | "prompt" | "granted" | "denied"
	console.log(state.platform); // "browser" | "pwa" | "ios-webview" | "android-webview"
	console.log(state.observedDenied); // true once denial has ever been observed
	console.log(state.error?.code); // typed MicPermsErrorCode union, or undefined
});

// Check current permission (via Permissions API)
await mic.check();

// Request permission (via getUserMedia, tracks released immediately)
await mic.request();

// Smart recheck: query first, fall back to getUserMedia if ambiguous
await mic.recheck();

// Open native app settings (iOS/Android WebView only)
mic.openSettings();

// Reset internal state (clears sticky-denial, error, status -> "unknown")
mic.reset();

// Cleanup (detaches listeners; also makes check/request log a warning)
mic.destroy();
```

### Configuration

```typescript
const mic = createMicPerms({
	platform: "ios-webview", // override auto-detection
	iosBridgeHandler: "openAppSettings", // iOS bridge handler name
	androidBridgeObject: "Android", // Android bridge object on window
	androidBridgeMethod: "openAppSettings",
	appResumedEvent: "app-resumed", // event fired by native layer on return
	adapter: myCustomAdapter, // injectable for testing
	logger: console, // default: noop
});
```

## Semantics

- **`getUserMedia()` is the only ground truth.** `check()` wraps
  `navigator.permissions.query({ name: "microphone" })`, which is not
  authoritative in mobile WebViews (see below). `request()` wraps
  `getUserMedia()`, which always reflects reality.
- **Sticky denial.** Once `request()` (or `onPermissionChange`) has observed
  `"denied"`, that state is cached internally — `state.observedDenied`
  becomes `true` and silent `check()` calls will not downgrade `status` to
  `"prompt"` / `"unknown"`. Cleared on any observed `"granted"`, by
  `openSettings()` (user is on their way to change the OS setting), or by
  the explicit `reset()` method.
- **Passive triggers never prompt.** Internal listeners for `visibilitychange`,
  `pageshow` (with `event.persisted === true` — bfcache restores), and
  `app-resumed` only call `check()` (silent). They never invoke
  `getUserMedia()`, which would produce an unexpected OS prompt.
- **`recheck()` is an opt-in escalation.** It calls `check()` and, if the
  result is ambiguous (`"prompt"` / `"unknown"`), escalates to `request()`.
  Only your code can trigger it — call it in response to a user gesture, not
  on resume.
- **Concurrent `check()` / `request()` calls coalesce.** Re-entrant calls
  while another is in flight return the same in-flight promise; the
  underlying adapter is invoked once per concurrent batch, and all callers
  observe an identical resolved value.
- **Device/origin errors are typed.** When `getUserMedia` rejects with
  `NotFoundError`, `SecurityError`, or `NotReadableError`, the rejection is
  classified into `state.error.code` (see [`MicPermsErrorCode`](API.md#micpermserrorcode))
  and `state.status` is preserved. UIs should check `error` before acting
  on `status`.

## Why the Permissions API is not trusted in WebViews

`navigator.permissions.query({ name: "microphone" })` is **not reliable** in
mobile WebViews. Concretely:

- **iOS WKWebView:** the Permissions API is **not implemented**. The adapter's
  `queryPermission()` returns `null` and `check()` preserves the prior status.
- **Android WebView:** the Permissions API **is** present but reports
  `"prompt"` even after the user has OS-denied microphone access (and in some
  Chromium versions, also when the embedder has already granted at the
  `WebChromeClient.onPermissionRequest()` layer). This is **not a library
  bug** — it is a consequence of the W3C Permissions API spec permitting a UA
  to return `"prompt"` when it cannot determine a persistent origin-scoped
  decision, combined with the fact that Android's microphone permission lives
  at the **app** layer, not the web-origin layer the Permissions API knows
  about. The JS runtime literally does not have the information, so the API
  returns its spec-permitted fallback. See ongoing Chromium discussions
  (search the Chromium issue tracker for "permissions.query microphone
  webview").
- **Desktop Chrome / Firefox / Safari:** the Permissions API is reliable;
  `check()` alone is sufficient to populate UI.

This is why sticky-denial exists: once `getUserMedia()` has produced a
`NotAllowedError` on Android WebView, that observation outranks any
subsequent `"prompt"` from the Permissions API. Before this was enforced
(fixed in `1.1.1`), the combination of a lying Permissions API and an
auto-`recheck()` on `visibilitychange` caused an infinite
`denied → prompt → denied → prompt → …` loop in Android WebView.

## API

See [API.md](API.md) for complete API documentation.

## License

[MIT](LICENSE)

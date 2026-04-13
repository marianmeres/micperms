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
});

// Check current permission (via Permissions API)
await mic.check();

// Request permission (via getUserMedia, tracks released immediately)
await mic.request();

// Smart recheck: query first, fall back to getUserMedia if ambiguous
await mic.recheck();

// Open native app settings (iOS/Android WebView only)
mic.openSettings();

// Cleanup
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

- **Sticky denial.** Once `getUserMedia` (via `request()`) has observed `"denied"`,
  that state is cached internally and silent `check()` calls will not downgrade it
  to `"prompt"` / `"unknown"`. Some platforms (Android WebView) report `"prompt"`
  from the Permissions API even after the user denied the OS mic prompt — that
  lying value is ignored. The sticky flag is cleared by any `"granted"` observation
  and by `openSettings()` (since the user is on their way to change the OS setting).
- **Passive triggers never prompt.** Internal listeners for `visibilitychange` and
  `app-resumed` only call `check()` (silent). They never invoke `getUserMedia`,
  which would produce an unexpected OS prompt.
- **`recheck()` is the only silent escalation.** It calls `check()` and, if the
  result is ambiguous (`"prompt"` / `"unknown"`), escalates to `request()`. Only
  your code can trigger it — call it in response to a user gesture, not on resume.

## API

See [API.md](API.md) for complete API documentation.

## License

[MIT](LICENSE)

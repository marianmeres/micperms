# @marianmeres/micperms — Agent Guide

## Quick Reference

- **Stack**: Deno, TypeScript
- **Runtime dependency**: `@marianmeres/store` (reactive store with Svelte-compatible `.subscribe()`)
- **Test**: `deno task test` | **Build example**: `deno task build:example`

## Project Structure

```
/src
  mod.ts          — Public exports (re-exports micperms.ts)
  micperms.ts     — Entire implementation (~280 lines)
/tests
  micperms.test.ts — Unit tests with mock adapter
/example
  index.html      — Vanilla JS demo page
/scripts
  build-npm.ts    — NPM package build script
```

## What This Library Does

Manages **microphone permission lifecycle only**: detect platform, check/request
permission state, track state reactively, support native bridge for opening settings.

Does NOT own MediaStreams. When `getUserMedia` is called to probe permission, all
tracks are stopped immediately.

## Key Concepts

| Concept                | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| **Adapter pattern**    | `MicPermsBrowserAdapter` abstracts browser APIs; inject mock for testing |
| **Platform detection** | Auto-detects: `browser`, `pwa`, `ios-webview`, `android-webview`         |
| **Bridge detection**   | Checks for iOS `webkit.messageHandlers` or Android JS interface          |
| **Reactive state**     | `@marianmeres/store` powers `subscribe()` (Svelte `$store` compatible)   |

## Public API

| Export                           | Type    | Purpose                                               |
| -------------------------------- | ------- | ----------------------------------------------------- |
| `createMicPerms(config?)`        | Factory | Main entry point, returns `MicPerms` instance         |
| `createDefaultAdapter()`         | Factory | Real browser adapter (Permissions API + getUserMedia) |
| `detectPlatform(config)`         | Helper  | Returns `MicPlatformContext`                          |
| `detectBridge(platform, config)` | Helper  | Returns `boolean`                                     |

### MicPerms instance methods

| Method           | Returns           | Description                                         |
| ---------------- | ----------------- | --------------------------------------------------- |
| `subscribe(cb)`  | `() => void`      | Reactive subscription (fires immediately)           |
| `get()`          | `MicPermsState`   | Current state snapshot                              |
| `check()`        | `Promise<status>` | Query via Permissions API                           |
| `request()`      | `Promise<status>` | Request via getUserMedia (stops tracks)             |
| `recheck()`      | `Promise<status>` | `check()` then fallback to `request()` if ambiguous |
| `openSettings()` | `boolean`         | Call native bridge to open app settings             |
| `destroy()`      | `void`            | Cleanup all listeners (idempotent)                  |

## Critical Conventions

1. All implementation lives in `src/micperms.ts` — single-file library
2. Use `globalThis` not `window` (Deno compatibility)
3. Tests use injectable `adapter` — never depend on real browser APIs
4. `getUserMedia` is permission-probing only — always stop tracks immediately
5. Format: tabs, 90-char line width, 4-space indent width (`deno fmt`)

## Before Making Changes

- [ ] Read `src/micperms.ts` for current implementation
- [ ] Check existing patterns and types
- [ ] Run `deno task test`
- [ ] Follow formatting: `deno fmt`

## Platform Quirks (iOS WKWebView)

- `navigator.permissions.query({ name: "microphone" })` may throw or return unreliable results
- `getUserMedia` returns `NotAllowedError` without prompting unless native app implements `WKUIDelegate` with `decisionHandler(.grant)`
- Deep-link URI schemes are silently swallowed; only `webkit.messageHandlers` bridge works
- Recovery requires native layer to fire custom `app-resumed` event

## Platform Quirks (Android WebView)

- **Lying Permissions API.** After the user denies the OS mic prompt, `navigator.permissions.query({ name: "microphone" }).state` returns `"prompt"` (not `"denied"`), while `getUserMedia` correctly rejects with `NotAllowedError`. `getUserMedia` is the only ground truth.
- **Sticky denial mitigation.** `createMicPerms` tracks an internal `observedDeniedAt` flag set whenever `requestPermission()` (or the `onPermissionChange` callback) returns `"denied"`. While set, `check()` coerces incoming `"prompt"` / `"unknown"` from the Permissions API back to `"denied"`. Cleared on any `"granted"` observation, and on `openSettings()` (user is on their way to change the OS setting). Do not remove without an alternative — it is what prevents the Android denial loop.
- **Passive triggers must never call `getUserMedia`.** The internal `visibilitychange` and `app-resumed` handlers call `check()` only. `getUserMedia` rejection on Android can transiently flip document visibility — combined with auto-escalation this used to fuel an unbounded loop. `recheck()` (which does escalate) remains opt-in for explicit consumer code.
- **Re-entrancy / debounce.** `check()` and `request()` no-op while `state.busy === true`. Passive handlers also skip if a check ran within `MIN_PASSIVE_INTERVAL_MS` (500ms).
- Recovery from denial requires the native layer to fire the configured `appResumedEvent` (default `"app-resumed"`) after `openSettings()` returns the user to the app.

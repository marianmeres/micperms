# API

## Functions

### `createMicPerms(config?)`

Create a microphone permission manager instance.

**Parameters:**

- `config` (`MicPermsConfig`, optional) — Configuration options

**Returns:** `MicPerms` — Permission manager instance with reactive state

**Example:**

```typescript
const mic = createMicPerms();
mic.subscribe((state) => console.log(state.status));
await mic.request();
mic.destroy();
```

---

### `createDefaultAdapter()`

Create the default browser adapter that uses real browser APIs (`navigator.permissions`
and `navigator.mediaDevices.getUserMedia`). Useful for consumers who want to wrap or
extend the default behavior.

**Returns:** `MicPermsBrowserAdapter`

**Example:**

```typescript
const defaultAdapter = createDefaultAdapter();
const mic = createMicPerms({ adapter: defaultAdapter });
```

---

### `detectPlatform(config)`

Detect the current platform context. Runs the same detection logic used internally
by `createMicPerms`. Useful for consumers who need platform info independently.

**Parameters:**

- `config` (`MicPermsConfig`) — Config with optional `platform` override and bridge object names

**Returns:** `MicPlatformContext`

Detection order (first match wins):

1. `config.platform` if provided (explicit override)
2. `webkit.messageHandlers` exists → `"ios-webview"`
3. Android bridge object exists → `"android-webview"`
4. Standalone display mode → `"pwa"`
5. Default → `"browser"`

iOS WKWebView is checked before PWA standalone mode because a hosted WKWebView
with native bridges is more specific than display-mode standalone.

---

### `detectBridge(platform, config)`

Detect whether a native bridge is available for opening app settings.

**Parameters:**

- `platform` (`MicPlatformContext`) — The detected platform
- `config` (`MicPermsConfig`) — Config with bridge handler/object names

**Returns:** `boolean`

---

## MicPerms Instance

Returned by `createMicPerms()`. After `destroy()`, `check()` and `request()` log a
warning and resolve to the current `status` without performing any work.

### `subscribe(cb)`

Subscribe to reactive state changes. Callback fires immediately with current state,
then on every change. Compatible with Svelte's `$store` contract.

**Parameters:**

- `cb` (`(state: MicPermsState) => void`) — State callback

**Returns:** `() => void` — Unsubscribe function

---

### `get()`

Get the current state snapshot.

**Returns:** `MicPermsState`

---

### `check()`

Query the current permission status via the Permissions API. Does not trigger a
browser prompt.

Concurrent calls coalesce: re-entrant `check()` while another check is in flight
returns the same in-flight promise. Both callers observe an identical resolved value.

**Returns:** `Promise<MicPermissionStatus>` — The resolved status. If the Permissions
API is unsupported (e.g. iOS WKWebView), `status` and `lastCheckedAt` are unchanged.

---

### `request()`

Request microphone permission via `getUserMedia({ audio: true })`. May trigger a
browser prompt. All tracks are stopped immediately — no stream is held.

Concurrent calls coalesce the same way as `check()`.

If `getUserMedia` rejects with a non-permission error (`NotFoundError`,
`SecurityError`, `NotReadableError`, …), the rejection is classified into a typed
{@link MicPermsErrorCode} on `state.error` and `state.status` is preserved
(rather than smeared to `"unknown"`).

**Returns:** `Promise<MicPermissionStatus>` — `"granted"`, `"denied"`, or the prior
`status` when the request errored without producing a permission decision.

---

### `recheck()`

Smart recheck: calls `check()` first. If the result is `"unknown"` or `"prompt"`
(ambiguous — common on iOS WKWebView), falls back to `request()` as a definitive
probe.

**Returns:** `Promise<MicPermissionStatus>`

---

### `openSettings()`

Attempt to open native app settings via the platform bridge.

- iOS: `webkit.messageHandlers[handler].postMessage({})`
- Android: `window[bridgeObject][bridgeMethod]()`
- Browser/PWA: returns `false` (no bridge available)

On success, also clears the sticky `observedDenied` flag (the user is on their way
to change the OS setting).

**Returns:** `boolean` — `true` if the bridge call was made, `false` otherwise

---

### `reset()`

Reset internal state to initial values:

- `status` → `"unknown"`
- `error` → `null`
- `lastCheckedAt` → `null`
- `observedDenied` → `false`

Does **not** detach event listeners (use `destroy()` for that). Safe to call
multiple times. No-op after `destroy()`.

Use this when an app-level signal (e.g., a "try again" button after a context
change) should clear the sticky-denial coercion without recreating the instance.

**Returns:** `void`

---

### `destroy()`

Remove all event listeners and clean up. Safe to call multiple times (idempotent).

---

## Types

### `MicPermissionStatus`

```typescript
type MicPermissionStatus = "unknown" | "prompt" | "granted" | "denied";
```

### `MicPlatformContext`

```typescript
type MicPlatformContext = "browser" | "pwa" | "ios-webview" | "android-webview";
```

### `MicPermsState`

```typescript
interface MicPermsState {
	status: MicPermissionStatus;
	platform: MicPlatformContext;
	canOpenSettings: boolean;
	busy: boolean;
	observedDenied: boolean;
	error: MicPermsError | null;
	lastCheckedAt: number | null;
}
```

| Field             | Description                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | Current permission status                                                                                                                                                   |
| `platform`        | Detected platform context                                                                                                                                                   |
| `canOpenSettings` | Whether a native bridge was detected                                                                                                                                        |
| `busy`            | `true` while an async operation is in progress                                                                                                                              |
| `observedDenied`  | `true` once `"denied"` has been observed; coerces ambiguous Permissions-API readings back to `"denied"`. Cleared by an observed `"granted"`, `openSettings()`, or `reset()` |
| `error`           | Last error, or `null`. See [`MicPermsErrorCode`](#micpermserrorcode)                                                                                                        |
| `lastCheckedAt`   | Timestamp (`Date.now()`) of last successful check/request, or `null`. A check that found the Permissions API unsupported does **not** advance this.                         |

### `MicPermsError`

```typescript
interface MicPermsError {
	code: MicPermsErrorCode;
	message: string;
}
```

### `MicPermsConfig`

```typescript
interface MicPermsConfig {
	platform?: MicPlatformContext;
	iosBridgeHandler?: string; // Default: "openAppSettings"
	androidBridgeObject?: string; // Default: "Android"
	androidBridgeMethod?: string; // Default: "openAppSettings"
	appResumedEvent?: string; // Default: "app-resumed"
	adapter?: MicPermsBrowserAdapter;
	logger?: {
		debug(...args: unknown[]): void;
		warn(...args: unknown[]): void;
		error(...args: unknown[]): void;
	};
}
```

### `MicPermsBrowserAdapter`

Injectable adapter interface for testing or customization.

```typescript
interface MicPermsBrowserAdapter {
	queryPermission(): Promise<MicPermissionStatus | null>;
	requestPermission(): Promise<MicPermissionStatus>;
	supportsPermissionsApi(): boolean;
	onPermissionChange(
		cb: (status: MicPermissionStatus) => void,
	): (() => void) | null;
}
```

| Method                     | Description                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `queryPermission()`        | Query via Permissions API. Return `null` if unsupported.                                                                        |
| `requestPermission()`      | Request via getUserMedia, stop tracks, return result. Throw for device-/origin-level failures so the factory can classify them. |
| `supportsPermissionsApi()` | Whether Permissions API is available.                                                                                           |
| `onPermissionChange(cb)`   | Listen for permission changes. Return cleanup fn or `null`.                                                                     |

### `MicPerms`

```typescript
interface MicPerms {
	subscribe(cb: (state: MicPermsState) => void): () => void;
	get(): MicPermsState;
	check(): Promise<MicPermissionStatus>;
	request(): Promise<MicPermissionStatus>;
	openSettings(): boolean;
	recheck(): Promise<MicPermissionStatus>;
	reset(): void;
	destroy(): void;
}
```

---

## Constants

### `MicPermsErrorCode`

Machine-readable error codes attached to `MicPermsState.error.code`.

```typescript
const MicPermsErrorCode = {
	CheckFailed: "CHECK_FAILED",
	RequestFailed: "REQUEST_FAILED",
	NoDevice: "NO_DEVICE",
	InsecureContext: "INSECURE_CONTEXT",
	DeviceBusy: "DEVICE_BUSY",
} as const;

type MicPermsErrorCode = typeof MicPermsErrorCode[keyof typeof MicPermsErrorCode];
```

| Code               | Cause                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `CHECK_FAILED`     | `adapter.queryPermission()` threw                                |
| `REQUEST_FAILED`   | `adapter.requestPermission()` threw a non-classified error       |
| `NO_DEVICE`        | `getUserMedia` threw `NotFoundError` / `DevicesNotFoundError`    |
| `INSECURE_CONTEXT` | `getUserMedia` threw `SecurityError` (insecure origin or policy) |
| `DEVICE_BUSY`      | `getUserMedia` threw `NotReadableError` / `TrackStartError`      |

When a `NO_DEVICE` / `INSECURE_CONTEXT` / `DEVICE_BUSY` error fires, `state.status`
is **preserved** (not flipped to `"unknown"`). UIs should consult `state.error`
before acting on `state.status`.

---

## Extras

### `createMicReenableGuide(opts)`

Mount a self-contained, framework-agnostic multi-step tutorial that explains how
the user can re-enable the microphone after denial. Lives at the subpath
`@marianmeres/micperms/mic-reenable-guide` so the main entry stays DOM-free.

**Import:**

```typescript
import {
	createMicReenableGuide,
	defaultStepsFor,
	detectFlavor,
	type MicReenableGuideFlavor,
	type MicReenableGuideOptions,
	type MicReenableGuideStepsBuilderContext,
} from "@marianmeres/micperms/mic-reenable-guide";
```

**Parameters:** `opts: MicReenableGuideOptions`

| Field            | Type                                                                                  | Description                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container`      | `HTMLElement` — **required**                                                          | Parent node. The guide is appended (not replaced).                                                                                                                                                                                                                                                                                                       |
| `platform`       | `MicPlatformContext` — optional                                                       | Forwarded to `detectPlatform` to seed flavor detection.                                                                                                                                                                                                                                                                                                  |
| `flavor`         | `MicReenableGuideFlavor` — optional                                                   | Override flavor directly. Wins over `platform`.                                                                                                                                                                                                                                                                                                          |
| `lang`           | `MicReenableGuideLang \| "auto"` — default `"auto"`                                   | Built-in translation. `"auto"` reads `navigator.language`. Falls back to `"en"` if no built-in match.                                                                                                                                                                                                                                                    |
| `steps`          | `MicReenableGuideStep[] \| ((ctx) => MicReenableGuideStep[])` — optional              | Step list. An **array** fully replaces text **and** art. A **builder** is called with `{ flavor, lang, defaultSteps }` (the `defaultSteps` already carry the built-in art) and returns the list — the zero-copy way to override only the text per flavor. Wins over `stepText`. See [Per-flavor step text](#per-flavor-step-text-keep-the-built-in-art). |
| `stepText`       | `Partial<Record<MicReenableGuideFlavor, (string \| null \| undefined)[]>>` — optional | Declarative per-flavor **text** override, merged by index over the default steps (**art preserved**). `null` / `undefined` / a missing index keeps the built-in copy; entries past the flavor's step count are ignored (clamped). Lang-agnostic. Ignored when `steps` is also set.                                                                       |
| `title`          | `string \| ((ctx) => string)` — optional                                              | Header title override — a string, or a `(ctx) => string` builder called with `{ flavor, lang, defaultText }` for flavor-aware copy. Wins over the `lang` translation. Rendered as **plain text** by the built-in chrome (use the `header` slot for HTML).                                                                                                |
| `subtitle`       | `string \| ((ctx) => string)` — optional                                              | Header subtitle override — a string, or a `(ctx) => string` builder. Wins over the `lang` translation. Plain text in the built-in chrome (see `title`).                                                                                                                                                                                                  |
| `theme`          | `"auto" \| "light" \| "dark"` — default `"auto"`                                      | `"auto"` mirrors `html.classList.contains("dark")` live (MutationObserver).                                                                                                                                                                                                                                                                              |
| `accent`         | `string` — optional                                                                   | Any CSS color; sets `--mpg-accent`.                                                                                                                                                                                                                                                                                                                      |
| `labels`         | `{ back?, next?, done?, openSettings? }`                                              | Per-key button label override (wins over the `lang` translation).                                                                                                                                                                                                                                                                                        |
| `onOpenSettings` | `() => void` — optional                                                               | When set on `*-webview` / `*-pwa` flavors, renders an "Open Settings" CTA.                                                                                                                                                                                                                                                                               |
| `onDone`         | `() => void` — optional                                                               | Fires when the user taps **Done** on the final step.                                                                                                                                                                                                                                                                                                     |

**Returns:** `MicReenableGuide`

```typescript
interface MicReenableGuide {
	readonly el: HTMLElement;
	readonly index: number;
	next(): void;
	back(): void;
	goto(i: number): void;
	setTheme(theme: "auto" | "light" | "dark"): void;
	destroy(): void;
}
```

**Flavors:**

```typescript
type MicReenableGuideFlavor =
	| "ios-safari"
	| "android-chrome"
	| "desktop"
	| "ios-webview"
	| "android-webview"
	| "ios-pwa"
	| "android-pwa";
```

**Languages:**

```typescript
type MicReenableGuideLang = "en" | "sk";

// Inspectable list of all supported codes:
const MIC_REENABLE_GUIDE_LANGS: readonly MicReenableGuideLang[];
```

The resolved code is also written to the root element's `lang` attribute, so
screen readers can pronounce content correctly. To add a language not in the
built-in set, supply your own `title` / `subtitle` / `labels` / `steps`.

**Example:**

```typescript
import { createMicPerms } from "@marianmeres/micperms";
import { createMicReenableGuide } from "@marianmeres/micperms/mic-reenable-guide";

const mic = createMicPerms();
const guide = createMicReenableGuide({
	container: document.getElementById("mic-help"),
	onOpenSettings: () => mic.openSettings(),
	onDone: () => mic.recheck(),
});

// later
guide.destroy();
```

#### Per-flavor step text (keep the built-in art)

You often want the library's flavor-correct **art, step count and navigation**
but your **own brand wording**. Don't copy the SVGs — supply a `steps` **builder**
(or the declarative `stepText` map) and the defaults hand you the art for free.

```typescript
const BROWSER_TEXTS_SK = [
	"Ťuknite na ikonu <b>Informácie</b> v riadku, kde sa zadáva webová adresa.",
	"Vyberte možnosť <b>Povolenia</b>.",
	"<b>Povoľte mikrofón</b> a obnovte stránku.",
];
const isBrowser = (f: MicReenableGuideFlavor) =>
	f === "desktop" || f === "ios-safari" || f === "android-chrome";

createMicReenableGuide({
	container,
	lang: "sk",
	// keep the built-in art, override only the text — per flavor, zero copy:
	steps: ({ flavor, defaultSteps }) =>
		isBrowser(flavor)
			? defaultSteps.map((s, i) => ({ ...s, text: BROWSER_TEXTS_SK[i] ?? s.text }))
			: defaultSteps, // webview / pwa keep the library copy + their own art
	// header copy can be flavor-aware too (plain text — see note below):
	subtitle: ({ flavor, defaultText }) =>
		isBrowser(flavor) ? "Povoľte mikrofón v nastaveniach prehliadača." : defaultText,
});
```

> **Note** — `step.text` (and `stepText`) is rendered as **trusted HTML** (so
> `<b>…</b>` works), but the built-in chrome renders `title` / `subtitle` as
> **plain text**. If you need markup in the header, use the `header` slot (or the
> headless `createMicReenableGuideController` with your own markup), both of
> which treat the copy as trusted HTML.

The builder receives a resolved `MicReenableGuideStepsBuilderContext`:

```typescript
interface MicReenableGuideStepsBuilderContext {
	flavor: MicReenableGuideFlavor; // resolved (never undefined)
	lang: MicReenableGuideLang; // resolved (never "auto")
	defaultSteps: MicReenableGuideStep[]; // built-in text + art for this flavor
}
```

For the simple single-language case the declarative `stepText` map is shorter —
it merges strings by index over the defaults and always preserves the art:

```typescript
createMicReenableGuide({
	container,
	lang: "sk",
	stepText: {
		desktop: BROWSER_TEXTS_SK,
		"ios-safari": BROWSER_TEXTS_SK,
		"android-chrome": BROWSER_TEXTS_SK,
		// any flavor you omit keeps the built-in copy + art
		// null / undefined at an index keeps that one step's built-in copy
	},
});
```

Notes:

- An **array** `steps` is still a full replace of text **and** art (unchanged).
- `steps` (array or builder) takes precedence over `stepText` if both are set.
- `stepText` clamps to the flavor's default step count; changing the **number**
  of steps stays the domain of the full `steps` array (new steps have no art).
- Both forms run once at resolution time and see the concrete resolved `lang`.

---

### `defaultStepsFor(flavor, lang)`

Return the library's built-in steps for a flavor + language — the resolved copy
paired with the matching built-in art. This is what the guide renders absent any
override, and what a `steps` builder receives as `defaultSteps`. Exported for
fully-custom renderers (e.g. a native component on top of
`createMicReenableGuideController`) that want the art + copy without copying any
SVG markup.

**Parameters:**

- `flavor` (`MicReenableGuideFlavor`) — the flavor to resolve.
- `lang` (`MicReenableGuideLang`) — a **concrete** language code (not `"auto"`).

**Returns:** `MicReenableGuideStep[]` — a fresh array of fresh step objects
(safe to mutate) carrying `{ text, art }`.

```typescript
const steps = defaultStepsFor("desktop", "en");
// [{ text: "Click the …", art: "<svg …>" }, …]
```

---

### `detectFlavor(opts?)`

Resolve a `MicReenableGuideFlavor` from platform context + user agent. Useful if
you want to render your own UI but still benefit from the bucketing logic.

**Parameters:**

- `opts.platform` — optional `MicPlatformContext` override (forwarded to `detectPlatform`).
- `opts.flavor` — optional explicit override; returned as-is.
- `opts.userAgent` — optional UA string; defaults to `navigator.userAgent`.

**Returns:** `MicReenableGuideFlavor`

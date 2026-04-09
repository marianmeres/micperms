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

---

### `detectBridge(platform, config)`

Detect whether a native bridge is available for opening app settings.

**Parameters:**
- `platform` (`MicPlatformContext`) — The detected platform
- `config` (`MicPermsConfig`) — Config with bridge handler/object names

**Returns:** `boolean`

---

## MicPerms Instance

Returned by `createMicPerms()`. All methods are safe to call after `destroy()`.

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

**Returns:** `Promise<MicPermissionStatus>` — The resolved status. If the
Permissions API is unsupported (e.g. iOS WKWebView), status remains unchanged.

---

### `request()`

Request microphone permission via `getUserMedia({ audio: true })`. May trigger a
browser prompt. All tracks are stopped immediately — no stream is held.

**Returns:** `Promise<MicPermissionStatus>` — `"granted"` or `"denied"`

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

**Returns:** `boolean` — `true` if the bridge call was made, `false` otherwise

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
    error: { code: string; message: string } | null;
    lastCheckedAt: number | null;
}
```

| Field | Description |
|-------|-------------|
| `status` | Current permission status |
| `platform` | Detected platform context |
| `canOpenSettings` | Whether a native bridge was detected |
| `busy` | `true` while an async operation is in progress |
| `error` | Last error (code: `"CHECK_FAILED"` or `"REQUEST_FAILED"`), or `null` |
| `lastCheckedAt` | Timestamp (`Date.now()`) of last successful check/request, or `null` |

### `MicPermsConfig`

```typescript
interface MicPermsConfig {
    platform?: MicPlatformContext;
    iosBridgeHandler?: string;       // Default: "openAppSettings"
    androidBridgeObject?: string;    // Default: "Android"
    androidBridgeMethod?: string;    // Default: "openAppSettings"
    appResumedEvent?: string;        // Default: "app-resumed"
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
        cb: (status: MicPermissionStatus) => void
    ): (() => void) | null;
}
```

| Method | Description |
|--------|-------------|
| `queryPermission()` | Query via Permissions API. Return `null` if unsupported. |
| `requestPermission()` | Request via getUserMedia, stop tracks, return result. |
| `supportsPermissionsApi()` | Whether Permissions API is available. |
| `onPermissionChange(cb)` | Listen for permission changes. Return cleanup fn or `null`. |

### `MicPerms`

```typescript
interface MicPerms {
    subscribe(cb: (state: MicPermsState) => void): () => void;
    get(): MicPermsState;
    check(): Promise<MicPermissionStatus>;
    request(): Promise<MicPermissionStatus>;
    openSettings(): boolean;
    recheck(): Promise<MicPermissionStatus>;
    destroy(): void;
}
```

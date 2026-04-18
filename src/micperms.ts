import { createClog } from "@marianmeres/clog";
import { createStore } from "@marianmeres/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Microphone permission status. */
export type MicPermissionStatus = "unknown" | "prompt" | "granted" | "denied";

/** Detected platform context. */
export type MicPlatformContext =
	| "browser"
	| "pwa"
	| "ios-webview"
	| "android-webview";

/**
 * Machine-readable error codes attached to {@linkcode MicPermsState.error}.
 *
 * - `CHECK_FAILED` — `adapter.queryPermission()` threw.
 * - `REQUEST_FAILED` — `adapter.requestPermission()` threw a non-classified error.
 * - `NO_DEVICE` — getUserMedia threw `NotFoundError` / `DevicesNotFoundError`.
 *   No microphone is available; `status` is preserved.
 * - `INSECURE_CONTEXT` — getUserMedia threw `SecurityError`. Origin is not
 *   secure or a Permissions-Policy blocks the API. `status` is preserved.
 * - `DEVICE_BUSY` — getUserMedia threw `NotReadableError` / `TrackStartError`.
 *   Hardware is held by another consumer. `status` is preserved.
 */
export const MicPermsErrorCode = {
	CheckFailed: "CHECK_FAILED",
	RequestFailed: "REQUEST_FAILED",
	NoDevice: "NO_DEVICE",
	InsecureContext: "INSECURE_CONTEXT",
	DeviceBusy: "DEVICE_BUSY",
} as const;
export type MicPermsErrorCode = typeof MicPermsErrorCode[keyof typeof MicPermsErrorCode];

/** Error attached to {@linkcode MicPermsState.error}. */
export interface MicPermsError {
	/** Machine-readable error code. See {@linkcode MicPermsErrorCode}. */
	code: MicPermsErrorCode;
	/** Human-readable error message (typically forwarded from underlying API). */
	message: string;
}

/** Reactive state of the microphone permission manager. */
export interface MicPermsState {
	/** Current permission status. */
	status: MicPermissionStatus;
	/** Detected platform context. */
	platform: MicPlatformContext;
	/** Whether a native bridge for opening app settings was detected. */
	canOpenSettings: boolean;
	/** `true` while an async operation (check/request) is in progress. */
	busy: boolean;
	/**
	 * `true` once any code path has observed `"denied"` from getUserMedia
	 * or the Permissions API. Cleared by an observed `"granted"`, by
	 * {@linkcode MicPerms.openSettings}, or by {@linkcode MicPerms.reset}.
	 *
	 * While `true`, ambiguous incoming statuses (`"prompt"` / `"unknown"`)
	 * are coerced to `"denied"` to mitigate the lying Android-WebView
	 * Permissions API.
	 */
	observedDenied: boolean;
	/** Last error, or `null`. See {@linkcode MicPermsErrorCode}. */
	error: MicPermsError | null;
	/**
	 * Timestamp (`Date.now()`) of last successful check/request, or `null`.
	 * "Successful" means the underlying API returned a value — a `check()`
	 * that found the Permissions API unsupported does not count.
	 */
	lastCheckedAt: number | null;
}

/**
 * Abstraction over browser permission APIs. Injectable for testing or
 * custom behavior. The default implementation wraps `navigator.permissions`
 * and `navigator.mediaDevices.getUserMedia`.
 *
 * Adapter contract for `requestPermission()`: return `"granted"` /
 * `"denied"` / `"prompt"` / `"unknown"` for known outcomes; throw for
 * device-/origin-level failures (no device, insecure origin, hardware
 * busy). The factory inspects thrown `DOMException` instances and
 * classifies them via {@linkcode MicPermsErrorCode}.
 */
export interface MicPermsBrowserAdapter {
	/** Query via Permissions API. Return `null` if API is unsupported. */
	queryPermission(): Promise<MicPermissionStatus | null>;
	/** Request via getUserMedia, immediately release stream. Return result. */
	requestPermission(): Promise<MicPermissionStatus>;
	/** Whether the Permissions API is available. */
	supportsPermissionsApi(): boolean;
	/** Listen for Permissions API `onchange`. Return cleanup fn, or `null` if unsupported. */
	onPermissionChange(
		cb: (status: MicPermissionStatus) => void,
	): (() => void) | null;
}

/** Configuration for {@linkcode createMicPerms}. */
export interface MicPermsConfig {
	/** Override auto-detection of the platform context. */
	platform?: MicPlatformContext;
	/** iOS `webkit.messageHandlers` handler name. Default: `"openAppSettings"`. */
	iosBridgeHandler?: string;
	/** Android bridge object name on `window`. Default: `"Android"`. */
	androidBridgeObject?: string;
	/** Android bridge method name. Default: `"openAppSettings"`. */
	androidBridgeMethod?: string;
	/** Event name fired by native layer on return from settings. Default: `"app-resumed"`. */
	appResumedEvent?: string;
	/** Injectable adapter for testing. Uses real browser APIs when omitted. */
	adapter?: MicPermsBrowserAdapter;
	/** Console-compatible logger. Default: `@marianmeres/clog` instance named `"micperms"`. */
	logger?: {
		debug(...args: unknown[]): void;
		warn(...args: unknown[]): void;
		error(...args: unknown[]): void;
	};
}

/** Public API returned by {@linkcode createMicPerms}. */
export interface MicPerms {
	/** Subscribe to reactive state changes. Fires immediately with current state. */
	subscribe(cb: (state: MicPermsState) => void): () => void;
	/** Get the current state snapshot. */
	get(): MicPermsState;
	/** Query permission status via Permissions API. Does not trigger a prompt. */
	check(): Promise<MicPermissionStatus>;
	/** Request permission via getUserMedia. May trigger a prompt. Tracks released immediately. */
	request(): Promise<MicPermissionStatus>;
	/** Attempt to open native app settings via platform bridge. Returns `true` if call was made. */
	openSettings(): boolean;
	/** Smart recheck: `check()` first, fall back to `request()` if ambiguous. */
	recheck(): Promise<MicPermissionStatus>;
	/**
	 * Reset internal state to initial values: `status` → `"unknown"`,
	 * `error` → `null`, `lastCheckedAt` → `null`, and the sticky
	 * `observedDenied` flag → `false`. Does not detach event listeners
	 * (use {@linkcode destroy} for that). Safe to call multiple times.
	 */
	reset(): void;
	/** Remove all event listeners. Safe to call multiple times. */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Default logger
// ---------------------------------------------------------------------------

const DEFAULT_LOGGER = createClog("micperms");

// ---------------------------------------------------------------------------
// Default browser adapter
// ---------------------------------------------------------------------------

/**
 * Create the default browser adapter that wraps `navigator.permissions` and
 * `navigator.mediaDevices.getUserMedia`. Useful for consumers who want to
 * extend or wrap the default behavior.
 */
export function createDefaultAdapter(): MicPermsBrowserAdapter {
	function supportsPermissionsApi(): boolean {
		return (
			typeof navigator !== "undefined" &&
			typeof navigator.permissions?.query === "function"
		);
	}

	async function queryPermission(): Promise<MicPermissionStatus | null> {
		try {
			if (!supportsPermissionsApi()) return null;
			const result = await navigator.permissions.query({
				name: "microphone" as PermissionName,
			});
			return result.state as MicPermissionStatus;
		} catch {
			return null;
		}
	}

	async function requestPermission(): Promise<MicPermissionStatus> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
			return "granted";
		} catch (e: unknown) {
			if (e instanceof DOMException) {
				const name = e.name;
				if (
					name === "NotAllowedError" ||
					name === "PermissionDeniedError"
				) {
					return "denied";
				}
				// Re-throw so the factory can classify NotFoundError /
				// SecurityError / NotReadableError into a typed error.
			}
			throw e;
		}
	}

	function onPermissionChange(
		cb: (status: MicPermissionStatus) => void,
	): (() => void) | null {
		if (!supportsPermissionsApi()) return null;
		let permStatus: PermissionStatus | null = null;
		let canceled = false;
		const handler = (): void => {
			if (canceled || !permStatus) return;
			cb(permStatus.state as MicPermissionStatus);
		};
		navigator.permissions
			.query({ name: "microphone" as PermissionName })
			.then((result: PermissionStatus) => {
				if (canceled) {
					// Cleanup ran before the query resolved. Make sure the
					// freshly-resolved PermissionStatus carries no handler
					// so the listener does not leak.
					result.onchange = null;
					return;
				}
				permStatus = result;
				result.onchange = handler;
			})
			.catch(() => {});
		return (): void => {
			canceled = true;
			if (permStatus) permStatus.onchange = null;
		};
	}

	return {
		queryPermission,
		requestPermission,
		supportsPermissionsApi,
		onPermissionChange,
	};
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

// Dynamic global access (webkit, Android, custom bridge object names) plus
// graceful absence in non-DOM runtimes. The `any` cast is the pragmatic
// alternative to a brittle ambient declaration.
// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

/**
 * Detect the current platform context. Returns `config.platform` if set
 * (explicit override), otherwise auto-detects by checking for iOS
 * `webkit.messageHandlers`, Android bridge object, PWA standalone mode,
 * or falls back to `"browser"`.
 *
 * Note: iOS WKWebView (`webkit.messageHandlers`) is checked before PWA
 * standalone mode. A hosted WKWebView with native bridges is more
 * specific than display-mode standalone — the PWA branch is a fallback
 * for standalone web apps without a native host.
 */
export function detectPlatform(config: MicPermsConfig): MicPlatformContext {
	if (config.platform) return config.platform;

	try {
		if (_g.webkit?.messageHandlers) return "ios-webview";
	} catch {
		// ignore
	}

	try {
		if (_g[config.androidBridgeObject ?? "Android"]) {
			return "android-webview";
		}
	} catch {
		// ignore
	}

	try {
		if (
			_g.matchMedia?.("(display-mode: standalone)").matches ||
			_g.navigator?.standalone === true
		) {
			return "pwa";
		}
	} catch {
		// ignore
	}

	return "browser";
}

// ---------------------------------------------------------------------------
// Bridge detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a native bridge is available for opening app settings.
 * Checks for iOS `webkit.messageHandlers[handler]` or Android
 * `window[bridgeObject][bridgeMethod]`.
 */
export function detectBridge(
	platform: MicPlatformContext,
	config: MicPermsConfig,
): boolean {
	const iosBridgeHandler = config.iosBridgeHandler ?? "openAppSettings";
	const androidBridgeObject = config.androidBridgeObject ?? "Android";
	const androidBridgeMethod = config.androidBridgeMethod ?? "openAppSettings";

	try {
		if (platform === "ios-webview") {
			return !!_g.webkit?.messageHandlers?.[iosBridgeHandler];
		}
		if (platform === "android-webview") {
			return (
				typeof _g[androidBridgeObject]?.[androidBridgeMethod] ===
					"function"
			);
		}
	} catch {
		// ignore
	}

	return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Classify a thrown `getUserMedia` failure into a {@linkcode MicPermsErrorCode}.
 * Distinguishes "permission was denied" (handled at the adapter level by
 * returning `"denied"`) from device-/origin-level failures that ought to
 * surface separately so UI can react accordingly.
 */
function classifyRequestError(e: unknown): MicPermsErrorCode {
	if (e instanceof DOMException) {
		const name = e.name;
		if (name === "NotFoundError" || name === "DevicesNotFoundError") {
			return MicPermsErrorCode.NoDevice;
		}
		if (name === "SecurityError") {
			return MicPermsErrorCode.InsecureContext;
		}
		if (name === "NotReadableError" || name === "TrackStartError") {
			return MicPermsErrorCode.DeviceBusy;
		}
	}
	return MicPermsErrorCode.RequestFailed;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a microphone permission manager instance. Detects the platform,
 * sets up reactive state via `@marianmeres/store`, and registers event
 * listeners for permission changes, app resume, page show (bfcache), and
 * visibility changes.
 *
 * The returned instance does **not** own MediaStreams — when `getUserMedia`
 * is called to probe permission, all tracks are stopped immediately.
 */
export function createMicPerms(config?: MicPermsConfig): MicPerms {
	const cfg: MicPermsConfig = { ...config };
	const iosBridgeHandler = cfg.iosBridgeHandler ?? "openAppSettings";
	const androidBridgeObject = cfg.androidBridgeObject ?? "Android";
	const androidBridgeMethod = cfg.androidBridgeMethod ?? "openAppSettings";
	const appResumedEvent = cfg.appResumedEvent ?? "app-resumed";
	const log = cfg.logger ?? DEFAULT_LOGGER;

	const platform = detectPlatform(cfg);
	const adapter = cfg.adapter ?? createDefaultAdapter();
	const canOpenSettings = detectBridge(platform, cfg);

	const store = createStore<MicPermsState>({
		status: "unknown",
		platform,
		canOpenSettings,
		busy: false,
		observedDenied: false,
		error: null,
		lastCheckedAt: null,
	});

	let destroyed = false;
	const cleanups: (() => void)[] = [];

	// In-flight promise caches: re-entrant callers receive the in-flight
	// promise so all callers observe a consistent resolved value (and the
	// underlying adapter is invoked only once per concurrent batch).
	let inFlightCheck: Promise<MicPermissionStatus> | null = null;
	let inFlightRequest: Promise<MicPermissionStatus> | null = null;

	const MIN_PASSIVE_INTERVAL_MS = 500;

	// --- sticky-denial bookkeeping ---

	function setObservedDenied(value: boolean): void {
		if (store.get().observedDenied === value) return;
		store.update((s) => ({ ...s, observedDenied: value }));
	}

	/**
	 * Record an observation. Mutates the sticky `observedDenied` flag:
	 * `"granted"` clears it, `"denied"` sets it, ambiguous values are
	 * left alone.
	 */
	function observeStatus(status: MicPermissionStatus): void {
		if (status === "granted") setObservedDenied(false);
		else if (status === "denied") setObservedDenied(true);
	}

	/**
	 * Pure read: project an incoming status through the sticky-denial
	 * flag. While `observedDenied` is set, `"prompt"` and `"unknown"`
	 * are coerced to `"denied"` (Android-WebView lying-API mitigation).
	 */
	function coerceStatus(incoming: MicPermissionStatus): MicPermissionStatus {
		if (
			store.get().observedDenied &&
			(incoming === "prompt" || incoming === "unknown")
		) {
			return "denied";
		}
		return incoming;
	}

	// --- event listeners ---

	const permCleanup = adapter.onPermissionChange(
		(status: MicPermissionStatus): void => {
			if (destroyed) return;
			observeStatus(status);
			const reconciled = coerceStatus(status);
			store.update((s) => ({
				...s,
				status: reconciled,
				lastCheckedAt: Date.now(),
			}));
		},
	);
	if (permCleanup) cleanups.push(permCleanup);

	function shouldSkipPassive(): boolean {
		const last = store.get().lastCheckedAt ?? 0;
		return Date.now() - last < MIN_PASSIVE_INTERVAL_MS;
	}

	if (typeof _g.addEventListener === "function") {
		const handleAppResumed = (): void => {
			if (destroyed || shouldSkipPassive()) return;
			check();
		};
		_g.addEventListener(appResumedEvent, handleAppResumed);
		cleanups.push(() => _g.removeEventListener(appResumedEvent, handleAppResumed));

		// pageshow with `persisted === true` indicates a bfcache restore
		// (notably on iOS Safari after a Settings round-trip, where
		// `visibilitychange` is unreliable).
		const handlePageshow = (e: Event): void => {
			if (destroyed) return;
			// deno-lint-ignore no-explicit-any
			if (!(e as any).persisted) return;
			if (shouldSkipPassive()) return;
			check();
		};
		_g.addEventListener("pageshow", handlePageshow);
		cleanups.push(() => _g.removeEventListener("pageshow", handlePageshow));
	}

	if (typeof _g.document !== "undefined") {
		const handleVisibility = (): void => {
			if (destroyed) return;
			if (_g.document.visibilityState !== "visible") return;
			if (shouldSkipPassive()) return;
			check();
		};
		_g.document.addEventListener("visibilitychange", handleVisibility);
		cleanups.push(() =>
			_g.document.removeEventListener(
				"visibilitychange",
				handleVisibility,
			)
		);
	}

	// --- methods ---

	async function check(): Promise<MicPermissionStatus> {
		if (destroyed) {
			log.warn("micperms: check() called after destroy() — no-op");
			return store.get().status;
		}
		if (inFlightCheck) return inFlightCheck;
		inFlightCheck = (async (): Promise<MicPermissionStatus> => {
			store.update((s) => ({ ...s, busy: true, error: null }));
			try {
				const result = await adapter.queryPermission();
				if (result !== null) observeStatus(result);
				const status = result === null
					? store.get().status
					: coerceStatus(result);
				store.update((s) => ({
					...s,
					status,
					busy: false,
					lastCheckedAt: result === null ? s.lastCheckedAt : Date.now(),
				}));
				return status;
			} catch (e: unknown) {
				const message = e instanceof Error
					? e.message
					: "Permission check failed";
				log.error("micperms check failed", e);
				store.update((s) => ({
					...s,
					busy: false,
					error: {
						code: MicPermsErrorCode.CheckFailed,
						message,
					},
				}));
				return store.get().status;
			} finally {
				inFlightCheck = null;
			}
		})();
		return inFlightCheck;
	}

	async function request(): Promise<MicPermissionStatus> {
		if (destroyed) {
			log.warn("micperms: request() called after destroy() — no-op");
			return store.get().status;
		}
		if (inFlightRequest) return inFlightRequest;
		inFlightRequest = (async (): Promise<MicPermissionStatus> => {
			store.update((s) => ({ ...s, busy: true, error: null }));
			try {
				const result = await adapter.requestPermission();
				observeStatus(result);
				const status = coerceStatus(result);
				store.update((s) => ({
					...s,
					status,
					busy: false,
					lastCheckedAt: Date.now(),
				}));
				return status;
			} catch (e: unknown) {
				const code = classifyRequestError(e);
				const message = e instanceof Error
					? e.message
					: "Permission request failed";
				log.error("micperms request failed", e);
				store.update((s) => ({
					...s,
					busy: false,
					error: { code, message },
				}));
				return store.get().status;
			} finally {
				inFlightRequest = null;
			}
		})();
		return inFlightRequest;
	}

	function openSettings(): boolean {
		if (!canOpenSettings) return false;
		try {
			if (platform === "ios-webview") {
				_g.webkit.messageHandlers[iosBridgeHandler].postMessage({});
				// User is on their way to change OS settings — clear sticky
				// denial so a genuine "granted" or "prompt" can be observed
				// on return.
				setObservedDenied(false);
				return true;
			}
			if (platform === "android-webview") {
				_g[androidBridgeObject][androidBridgeMethod]();
				setObservedDenied(false);
				return true;
			}
		} catch (e) {
			log.error("micperms openSettings failed", e);
		}
		return false;
	}

	async function recheck(): Promise<MicPermissionStatus> {
		const status = await check();
		if (status === "unknown" || status === "prompt") {
			return await request();
		}
		return status;
	}

	function reset(): void {
		if (destroyed) return;
		store.update((s) => ({
			...s,
			status: "unknown",
			observedDenied: false,
			error: null,
			lastCheckedAt: null,
		}));
	}

	function destroy(): void {
		if (destroyed) return;
		destroyed = true;
		cleanups.forEach((fn) => fn());
		cleanups.length = 0;
	}

	return {
		subscribe: store.subscribe.bind(store),
		get: store.get.bind(store),
		check,
		request,
		openSettings,
		recheck,
		reset,
		destroy,
	};
}

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
	/** Last error, or `null`. Code is `"CHECK_FAILED"` or `"REQUEST_FAILED"`. */
	error: { code: string; message: string } | null;
	/** Timestamp (`Date.now()`) of last successful check/request, or `null`. */
	lastCheckedAt: number | null;
}

/**
 * Abstraction over browser permission APIs. Injectable for testing or
 * custom behavior. The default implementation wraps `navigator.permissions`
 * and `navigator.mediaDevices.getUserMedia`.
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
	/** Console-compatible logger. Default: noop. */
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
	/** Request permission via getUserMedia. May trigger a browser prompt. Tracks are stopped immediately. */
	request(): Promise<MicPermissionStatus>;
	/** Attempt to open native app settings via platform bridge. Returns `true` if the call was made. */
	openSettings(): boolean;
	/** Smart recheck: `check()` first, fall back to `request()` if ambiguous. */
	recheck(): Promise<MicPermissionStatus>;
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
			}
			return "unknown";
		}
	}

	function onPermissionChange(
		cb: (status: MicPermissionStatus) => void,
	): (() => void) | null {
		if (!supportsPermissionsApi()) return null;
		let permStatus: PermissionStatus | null = null;
		const handler = (): void => {
			if (permStatus) cb(permStatus.state as MicPermissionStatus);
		};
		navigator.permissions
			.query({ name: "microphone" as PermissionName })
			.then((result: PermissionStatus) => {
				permStatus = result;
				result.onchange = handler;
			})
			.catch(() => {});
		return (): void => {
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

// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

/**
 * Detect the current platform context. Returns `config.platform` if set
 * (explicit override), otherwise auto-detects by checking for iOS
 * `webkit.messageHandlers`, Android bridge object, PWA standalone mode,
 * or falls back to `"browser"`.
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
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a microphone permission manager instance. Detects the platform,
 * sets up reactive state via `@marianmeres/store`, and registers event
 * listeners for permission changes, app resume, and visibility changes.
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
		error: null,
		lastCheckedAt: null,
	});

	let destroyed = false;
	const cleanups: (() => void)[] = [];

	// Sticky observed-denial. Set when getUserMedia (or onPermissionChange)
	// reports "denied" — coerces lying Permissions API results until cleared
	// by a "granted" observation or by openSettings().
	let observedDeniedAt: number | null = null;
	const MIN_PASSIVE_INTERVAL_MS = 500;

	function reconcileIncomingStatus(
		incoming: MicPermissionStatus,
	): MicPermissionStatus {
		if (incoming === "granted") {
			observedDeniedAt = null;
			return "granted";
		}
		if (incoming === "denied") {
			observedDeniedAt = Date.now();
			return "denied";
		}
		if (observedDeniedAt !== null) {
			return "denied";
		}
		return incoming;
	}

	// --- event listeners ---

	const permCleanup = adapter.onPermissionChange(
		(status: MicPermissionStatus): void => {
			if (!destroyed) {
				const reconciled = reconcileIncomingStatus(status);
				store.update((s) => ({
					...s,
					status: reconciled,
					lastCheckedAt: Date.now(),
				}));
			}
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
		cleanups.push(() =>
			_g.removeEventListener(appResumedEvent, handleAppResumed),
		);
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
			),
		);
	}

	// --- methods ---

	async function check(): Promise<MicPermissionStatus> {
		if (destroyed) return store.get().status;
		if (store.get().busy) return store.get().status;
		store.update((s) => ({ ...s, busy: true, error: null }));
		try {
			const result = await adapter.queryPermission();
			// If Permissions API is unsupported (null), preserve prior status.
			const incoming = result ?? store.get().status;
			const status =
				result === null ? incoming : reconcileIncomingStatus(incoming);
			store.update((s) => ({
				...s,
				status,
				busy: false,
				lastCheckedAt: Date.now(),
			}));
			return status;
		} catch (e: unknown) {
			const message =
				e instanceof Error ? e.message : "Permission check failed";
			log.error("micperms check failed", e);
			store.update((s) => ({
				...s,
				busy: false,
				error: { code: "CHECK_FAILED", message },
			}));
			return store.get().status;
		}
	}

	async function request(): Promise<MicPermissionStatus> {
		if (destroyed) return store.get().status;
		if (store.get().busy) return store.get().status;
		store.update((s) => ({ ...s, busy: true, error: null }));
		try {
			const result = await adapter.requestPermission();
			const status = reconcileIncomingStatus(result);
			store.update((s) => ({
				...s,
				status,
				busy: false,
				lastCheckedAt: Date.now(),
			}));
			return status;
		} catch (e: unknown) {
			const message =
				e instanceof Error ? e.message : "Permission request failed";
			log.error("micperms request failed", e);
			store.update((s) => ({
				...s,
				busy: false,
				error: { code: "REQUEST_FAILED", message },
			}));
			return store.get().status;
		}
	}

	function openSettings(): boolean {
		if (!canOpenSettings) return false;
		try {
			if (platform === "ios-webview") {
				_g.webkit.messageHandlers[iosBridgeHandler].postMessage({});
				// User is on their way to change OS settings — clear sticky denial
				// so a genuine "granted" or "prompt" can be observed on return.
				observedDeniedAt = null;
				return true;
			}
			if (platform === "android-webview") {
				_g[androidBridgeObject][androidBridgeMethod]();
				observedDeniedAt = null;
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
		destroy,
	};
}

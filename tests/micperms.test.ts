import { assertEquals } from "@std/assert";
import {
	createDefaultAdapter,
	createMicPerms,
	type MicPermissionStatus,
	type MicPermsBrowserAdapter,
	MicPermsErrorCode,
	type MicPermsState,
} from "../src/micperms.ts";

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

interface MockAdapter extends MicPermsBrowserAdapter {
	queryCallCount: number;
	requestCallCount: number;
	setQueryResult(v: MicPermissionStatus | null): void;
	setRequestResult(v: MicPermissionStatus): void;
	setQueryFn(fn: () => Promise<MicPermissionStatus | null>): void;
}

function createMockAdapter(opts?: {
	initialState?: MicPermissionStatus;
	supportsPermissions?: boolean;
	requestResult?: MicPermissionStatus;
}): MockAdapter {
	const supportsPermissions = opts?.supportsPermissions ?? true;
	let queryResult: MicPermissionStatus | null = supportsPermissions
		? (opts?.initialState ?? "prompt")
		: null;
	let requestResult: MicPermissionStatus = opts?.requestResult ?? "granted";
	let queryFn: (() => Promise<MicPermissionStatus | null>) | null = null;

	const adapter: MockAdapter = {
		queryCallCount: 0,
		requestCallCount: 0,
		queryPermission: () => {
			adapter.queryCallCount++;
			if (queryFn) return queryFn();
			return Promise.resolve(queryResult);
		},
		requestPermission: () => {
			adapter.requestCallCount++;
			return Promise.resolve(requestResult);
		},
		supportsPermissionsApi: () => supportsPermissions,
		onPermissionChange: () => null,
		setQueryResult: (v) => {
			queryResult = v;
		},
		setRequestResult: (v) => {
			requestResult = v;
		},
		setQueryFn: (fn) => {
			queryFn = fn;
		},
	};
	return adapter;
}

// ---------------------------------------------------------------------------
// Fake document helpers for visibility/app-resumed tests
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

function installFakeDocument(visibilityState: "visible" | "hidden" = "visible") {
	const target = new EventTarget();
	const fake = {
		visibilityState,
		addEventListener: target.addEventListener.bind(target),
		removeEventListener: target.removeEventListener.bind(target),
		dispatchEvent: target.dispatchEvent.bind(target),
	};
	const prev = _g.document;
	_g.document = fake;
	return {
		dispatch: (type: string) => target.dispatchEvent(new Event(type)),
		restore: () => {
			_g.document = prev;
		},
	};
}

async function waitMicrotasks(n = 3): Promise<void> {
	for (let i = 0; i < n; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("initial state is unknown and not busy", () => {
	const mic = createMicPerms({ adapter: createMockAdapter() });
	const s = mic.get();
	assertEquals(s.status, "unknown");
	assertEquals(s.busy, false);
	assertEquals(s.error, null);
	assertEquals(s.lastCheckedAt, null);
	mic.destroy();
});

Deno.test("check() transitions to prompt", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ initialState: "prompt" }),
	});
	const status = await mic.check();
	assertEquals(status, "prompt");
	assertEquals(mic.get().status, "prompt");
	mic.destroy();
});

Deno.test("check() transitions to granted", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ initialState: "granted" }),
	});
	const status = await mic.check();
	assertEquals(status, "granted");
	assertEquals(typeof mic.get().lastCheckedAt, "number");
	mic.destroy();
});

Deno.test("check() transitions to denied", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ initialState: "denied" }),
	});
	const status = await mic.check();
	assertEquals(status, "denied");
	mic.destroy();
});

Deno.test("check() with unsupported Permissions API stays unknown", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ supportsPermissions: false }),
	});
	const status = await mic.check();
	assertEquals(status, "unknown");
	assertEquals(mic.get().status, "unknown");
	mic.destroy();
});

Deno.test("request() grants permission", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ requestResult: "granted" }),
	});
	const status = await mic.request();
	assertEquals(status, "granted");
	assertEquals(mic.get().status, "granted");
	mic.destroy();
});

Deno.test("request() denies permission", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ requestResult: "denied" }),
	});
	const status = await mic.request();
	assertEquals(status, "denied");
	assertEquals(mic.get().status, "denied");
	mic.destroy();
});

Deno.test("recheck() falls back to request when query returns null", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({
			supportsPermissions: false,
			requestResult: "granted",
		}),
	});
	const status = await mic.recheck();
	assertEquals(status, "granted");
	assertEquals(mic.get().status, "granted");
	mic.destroy();
});

Deno.test("subscribe() fires immediately with current state", () => {
	const mic = createMicPerms({ adapter: createMockAdapter() });
	const states: MicPermsState[] = [];
	const unsub = mic.subscribe((s) => states.push(s));
	assertEquals(states.length, 1);
	assertEquals(states[0].status, "unknown");
	unsub();
	mic.destroy();
});

Deno.test("platform override via config", () => {
	const mic = createMicPerms({
		platform: "ios-webview",
		adapter: createMockAdapter(),
	});
	assertEquals(mic.get().platform, "ios-webview");
	mic.destroy();
});

Deno.test("canOpenSettings is false for browser platform", () => {
	const mic = createMicPerms({
		platform: "browser",
		adapter: createMockAdapter(),
	});
	assertEquals(mic.get().canOpenSettings, false);
	assertEquals(mic.openSettings(), false);
	mic.destroy();
});

Deno.test("destroy() is idempotent", () => {
	const mic = createMicPerms({ adapter: createMockAdapter() });
	mic.destroy();
	mic.destroy();
	// no error thrown — passes
});

Deno.test("busy is false after async operations complete", async () => {
	const mic = createMicPerms({
		adapter: createMockAdapter({ initialState: "granted" }),
	});
	await mic.check();
	assertEquals(mic.get().busy, false);
	await mic.request();
	assertEquals(mic.get().busy, false);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// Android-loop regression tests
// ---------------------------------------------------------------------------

Deno.test("sticky denial survives a lying Permissions API", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMicPerms({ platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	// Lying Permissions API says "prompt" after OS denial
	adapter.setQueryResult("prompt");
	const checked = await mic.check();
	assertEquals(checked, "denied");
	assertEquals(mic.get().status, "denied");
	mic.destroy();
});

Deno.test("granted observation clears the sticky denial flag", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMicPerms({ platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	// User granted via OS settings -> query now returns granted
	adapter.setQueryResult("granted");
	assertEquals(await mic.check(), "granted");
	// Sticky cleared: a later "prompt" is not coerced back to denied
	adapter.setQueryResult("prompt");
	assertEquals(await mic.check(), "prompt");
	mic.destroy();
});

Deno.test("visibilitychange does not escalate to request", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		const mic = createMicPerms({ platform: "browser", adapter });
		await mic.request();
		assertEquals(mic.get().status, "denied");
		const requestsBefore = adapter.requestCallCount;
		const queriesBefore = adapter.queryCallCount;
		// Wait past the passive-debounce window so the handler doesn't skip.
		await new Promise((r) => setTimeout(r, 600));
		fake.dispatch("visibilitychange");
		await waitMicrotasks();
		await new Promise((r) => setTimeout(r, 10));
		assertEquals(adapter.requestCallCount, requestsBefore);
		// check() was attempted (query invoked) at least once
		if (adapter.queryCallCount <= queriesBefore) {
			throw new Error("expected queryPermission to have been called");
		}
		mic.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("no loop under the Android-lying scenario", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		// Query ALWAYS lies with "prompt"
		adapter.setQueryResult("prompt");
		const mic = createMicPerms({ platform: "browser", adapter });
		await mic.request();
		assertEquals(mic.get().status, "denied");
		assertEquals(adapter.requestCallCount, 1);
		// 10 visibility events with tiny delays past debounce window
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 60));
			fake.dispatch("visibilitychange");
			await waitMicrotasks();
		}
		await new Promise((r) => setTimeout(r, 20));
		assertEquals(adapter.requestCallCount, 1);
		assertEquals(mic.get().status, "denied");
		mic.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("re-entrancy guard: concurrent check() calls only query once", async () => {
	let resolveQuery: (v: MicPermissionStatus | null) => void = () => {};
	const adapter = createMockAdapter({ initialState: "prompt" });
	adapter.setQueryFn(
		() =>
			new Promise<MicPermissionStatus | null>((r) => {
				resolveQuery = r;
			}),
	);
	const mic = createMicPerms({ platform: "browser", adapter });
	const p1 = mic.check();
	const p2 = mic.check();
	resolveQuery("granted");
	const [r1, r2] = await Promise.all([p1, p2]);
	assertEquals(adapter.queryCallCount, 1);
	// Both callers must observe the same resolved value (B2 regression).
	assertEquals(r1, "granted");
	assertEquals(r2, "granted");
	mic.destroy();
});

Deno.test("re-entrancy guard: concurrent request() calls only request once", async () => {
	let resolveRequest: (v: MicPermissionStatus) => void = () => {};
	const adapter: MicPermsBrowserAdapter & { requestCallCount: number } = {
		queryPermission: () => Promise.resolve(null),
		requestPermission: () => {
			adapter.requestCallCount++;
			return new Promise<MicPermissionStatus>((r) => {
				resolveRequest = r;
			});
		},
		supportsPermissionsApi: () => false,
		onPermissionChange: () => null,
		requestCallCount: 0,
	};
	const mic = createMicPerms({ platform: "browser", adapter });
	const p1 = mic.request();
	const p2 = mic.request();
	resolveRequest("granted");
	const [r1, r2] = await Promise.all([p1, p2]);
	assertEquals(adapter.requestCallCount, 1);
	assertEquals(r1, "granted");
	assertEquals(r2, "granted");
	mic.destroy();
});

Deno.test("app-resumed does not escalate to request", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMicPerms({ platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	const requestsBefore = adapter.requestCallCount;
	await new Promise((r) => setTimeout(r, 600));
	_g.dispatchEvent(new Event("app-resumed"));
	await waitMicrotasks();
	await new Promise((r) => setTimeout(r, 10));
	assertEquals(adapter.requestCallCount, requestsBefore);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// B1 — default adapter does not leak onchange after early destroy
// ---------------------------------------------------------------------------

interface FakePermissionStatus {
	state: string;
	onchange: (() => void) | null;
}

function installFakeNavigator() {
	let resolveQuery: ((s: FakePermissionStatus) => void) | null = null;
	let permStatusInstance: FakePermissionStatus | null = null;
	const fakePermissions = {
		query: () =>
			new Promise<FakePermissionStatus>((r) => {
				resolveQuery = r;
			}),
	};
	// Deno's `navigator` is a real instance; add `permissions` via
	// defineProperty so the default adapter sees it through `navigator.permissions`.
	const hadPermissions = Object.prototype.hasOwnProperty.call(
		_g.navigator,
		"permissions",
	);
	const prev = hadPermissions ? _g.navigator.permissions : undefined;
	Object.defineProperty(_g.navigator, "permissions", {
		value: fakePermissions,
		configurable: true,
		writable: true,
	});
	return {
		resolveQuery: (state: string): FakePermissionStatus => {
			permStatusInstance = { state, onchange: null };
			resolveQuery?.(permStatusInstance);
			return permStatusInstance;
		},
		getPermStatus: () => permStatusInstance,
		restore: () => {
			if (hadPermissions) {
				Object.defineProperty(_g.navigator, "permissions", {
					value: prev,
					configurable: true,
					writable: true,
				});
			} else {
				delete _g.navigator.permissions;
			}
		},
	};
}

Deno.test("B1: default adapter onchange does not leak after early destroy", async () => {
	const fakeNav = installFakeNavigator();
	try {
		const adapter = createDefaultAdapter();
		let cbCalls = 0;
		const cleanup = adapter.onPermissionChange(() => {
			cbCalls++;
		})!;
		// Destroy BEFORE the navigator.permissions.query promise resolves.
		cleanup();
		// Now resolve.
		const permStatus = fakeNav.resolveQuery("prompt");
		await waitMicrotasks(5);
		// Handler must not have been wired up.
		assertEquals(permStatus.onchange, null);
		// Even if we manually invoke whatever was set, no callback fires.
		permStatus.onchange?.();
		assertEquals(cbCalls, 0);
	} finally {
		fakeNav.restore();
	}
});

Deno.test("B1: default adapter onchange cleanup works in the normal path too", async () => {
	const fakeNav = installFakeNavigator();
	try {
		const adapter = createDefaultAdapter();
		let cbCalls = 0;
		const cleanup = adapter.onPermissionChange(() => {
			cbCalls++;
		})!;
		const permStatus = fakeNav.resolveQuery("prompt");
		await waitMicrotasks(5);
		// Handler is wired.
		if (typeof permStatus.onchange !== "function") {
			throw new Error("expected onchange to be wired");
		}
		// Fire it once -> callback fires.
		permStatus.onchange?.();
		assertEquals(cbCalls, 1);
		// Cleanup -> handler detached.
		cleanup();
		assertEquals(permStatus.onchange, null);
	} finally {
		fakeNav.restore();
	}
});

// ---------------------------------------------------------------------------
// B3 — onchange + reconcile interplay (sticky flag stays consistent)
// ---------------------------------------------------------------------------

Deno.test("B3: onchange-observed denial keeps sticky flag set across in-flight check", async () => {
	let resolveQuery: (v: MicPermissionStatus | null) => void = () => {};
	let onchangeCb: ((s: MicPermissionStatus) => void) | null = null;
	const adapter: MicPermsBrowserAdapter = {
		queryPermission: () =>
			new Promise<MicPermissionStatus | null>((r) => {
				resolveQuery = r;
			}),
		requestPermission: () => Promise.resolve("granted"),
		supportsPermissionsApi: () => true,
		onPermissionChange: (cb) => {
			onchangeCb = cb;
			return () => {};
		},
	};
	const mic = createMicPerms({ platform: "browser", adapter });
	const p = mic.check();
	// Onchange fires "denied" mid-flight.
	onchangeCb!("denied");
	// Lying API resolves with "prompt".
	resolveQuery("prompt");
	const result = await p;
	// Sticky flag was set by onchange — check() must coerce "prompt" to "denied".
	assertEquals(result, "denied");
	assertEquals(mic.get().status, "denied");
	assertEquals(mic.get().observedDenied, true);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// B4 — getUserMedia error classification
// ---------------------------------------------------------------------------

function adapterRejecting(name: string): MicPermsBrowserAdapter {
	return {
		queryPermission: () => Promise.resolve(null),
		requestPermission: () => Promise.reject(new DOMException("err", name)),
		supportsPermissionsApi: () => false,
		onPermissionChange: () => null,
	};
}

Deno.test("B4: NotFoundError surfaces NO_DEVICE error code, status preserved", async () => {
	const mic = createMicPerms({
		platform: "browser",
		adapter: adapterRejecting("NotFoundError"),
	});
	const result = await mic.request();
	// Status is preserved (initial "unknown") rather than smeared to "unknown" by
	// a swallowed error.
	assertEquals(result, "unknown");
	assertEquals(mic.get().status, "unknown");
	assertEquals(mic.get().error?.code, MicPermsErrorCode.NoDevice);
	mic.destroy();
});

Deno.test("B4: SecurityError surfaces INSECURE_CONTEXT error code", async () => {
	const mic = createMicPerms({
		platform: "browser",
		adapter: adapterRejecting("SecurityError"),
	});
	await mic.request();
	assertEquals(mic.get().error?.code, MicPermsErrorCode.InsecureContext);
	mic.destroy();
});

Deno.test("B4: NotReadableError surfaces DEVICE_BUSY error code", async () => {
	const mic = createMicPerms({
		platform: "browser",
		adapter: adapterRejecting("NotReadableError"),
	});
	await mic.request();
	assertEquals(mic.get().error?.code, MicPermsErrorCode.DeviceBusy);
	mic.destroy();
});

Deno.test("B4: unknown DOMException falls back to REQUEST_FAILED", async () => {
	const mic = createMicPerms({
		platform: "browser",
		adapter: adapterRejecting("AbortError"),
	});
	await mic.request();
	assertEquals(mic.get().error?.code, MicPermsErrorCode.RequestFailed);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// B5 — lastCheckedAt only advances when the API returned a value
// ---------------------------------------------------------------------------

Deno.test("B5: check() with unsupported Permissions API does not advance lastCheckedAt", async () => {
	const mic = createMicPerms({
		platform: "browser",
		adapter: createMockAdapter({ supportsPermissions: false }),
	});
	assertEquals(mic.get().lastCheckedAt, null);
	await mic.check();
	assertEquals(mic.get().lastCheckedAt, null);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// D3 — reset() clears sticky denial, error, and lastCheckedAt
// ---------------------------------------------------------------------------

Deno.test("D3: reset() clears observedDenied, error, status, and lastCheckedAt", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMicPerms({ platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	assertEquals(mic.get().observedDenied, true);
	assertEquals(typeof mic.get().lastCheckedAt, "number");
	mic.reset();
	assertEquals(mic.get().status, "unknown");
	assertEquals(mic.get().observedDenied, false);
	assertEquals(mic.get().error, null);
	assertEquals(mic.get().lastCheckedAt, null);
	// After reset, lying "prompt" is no longer coerced to denied.
	adapter.setQueryResult("prompt");
	const checked = await mic.check();
	assertEquals(checked, "prompt");
	mic.destroy();
});

Deno.test("D3: reset() is a no-op after destroy", () => {
	const mic = createMicPerms({ adapter: createMockAdapter() });
	mic.destroy();
	mic.reset();
	mic.reset();
	// no throw — passes
});

// ---------------------------------------------------------------------------
// D4 — post-destroy check()/request() warn instead of silently no-op'ing
// ---------------------------------------------------------------------------

Deno.test("D4: post-destroy check()/request() log warnings", async () => {
	const warnCalls: unknown[][] = [];
	const mic = createMicPerms({
		adapter: createMockAdapter(),
		logger: {
			debug: () => {},
			warn: (...args) => warnCalls.push(args),
			error: () => {},
		},
	});
	mic.destroy();
	await mic.check();
	await mic.request();
	assertEquals(warnCalls.length, 2);
});

// ---------------------------------------------------------------------------
// I1 — pageshow with persisted=true triggers check
// ---------------------------------------------------------------------------

Deno.test("I1: pageshow with persisted=true triggers passive check", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({ initialState: "granted" });
		const mic = createMicPerms({ platform: "browser", adapter });
		const queriesBefore = adapter.queryCallCount;
		await new Promise((r) => setTimeout(r, 600));
		const event = new Event("pageshow");
		Object.defineProperty(event, "persisted", { value: true });
		_g.dispatchEvent(event);
		await waitMicrotasks();
		await new Promise((r) => setTimeout(r, 10));
		if (adapter.queryCallCount <= queriesBefore) {
			throw new Error("expected pageshow to trigger check()");
		}
		mic.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("I1: pageshow without persisted does NOT trigger passive check", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({ initialState: "granted" });
		const mic = createMicPerms({ platform: "browser", adapter });
		const queriesBefore = adapter.queryCallCount;
		await new Promise((r) => setTimeout(r, 600));
		_g.dispatchEvent(new Event("pageshow"));
		await waitMicrotasks();
		await new Promise((r) => setTimeout(r, 10));
		assertEquals(adapter.queryCallCount, queriesBefore);
		mic.destroy();
	} finally {
		fake.restore();
	}
});

// ---------------------------------------------------------------------------
// I3 — observedDenied is exposed in state
// ---------------------------------------------------------------------------

Deno.test("I3: observedDenied reflects denial observations", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMicPerms({ platform: "browser", adapter });
	assertEquals(mic.get().observedDenied, false);
	await mic.request();
	assertEquals(mic.get().observedDenied, true);
	adapter.setQueryResult("granted");
	await mic.check();
	assertEquals(mic.get().observedDenied, false);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// openSettings() bridge call clears sticky denial (iOS path)
// ---------------------------------------------------------------------------

Deno.test("openSettings() (iOS bridge) clears sticky denial and posts message", async () => {
	const calls: unknown[] = [];
	const prevWebkit = _g.webkit;
	_g.webkit = {
		messageHandlers: {
			openAppSettings: {
				postMessage: (msg: unknown) => calls.push(msg),
			},
		},
	};
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		const mic = createMicPerms({ platform: "ios-webview", adapter });
		await mic.request();
		assertEquals(mic.get().observedDenied, true);
		assertEquals(mic.get().canOpenSettings, true);
		const opened = mic.openSettings();
		assertEquals(opened, true);
		assertEquals(calls.length, 1);
		assertEquals(mic.get().observedDenied, false);
		mic.destroy();
	} finally {
		_g.webkit = prevWebkit;
	}
});

Deno.test("openSettings() (Android bridge) clears sticky denial and calls method", async () => {
	let called = 0;
	const prevAndroid = _g.Android;
	_g.Android = { openAppSettings: () => called++ };
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		const mic = createMicPerms({ platform: "android-webview", adapter });
		await mic.request();
		assertEquals(mic.get().observedDenied, true);
		assertEquals(mic.openSettings(), true);
		assertEquals(called, 1);
		assertEquals(mic.get().observedDenied, false);
		mic.destroy();
	} finally {
		_g.Android = prevAndroid;
	}
});

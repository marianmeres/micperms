import { assertEquals } from "@std/assert";
import {
	createMicPerms,
	type MicPermissionStatus,
	type MicPermsBrowserAdapter,
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
	resolveQuery("prompt");
	await Promise.all([p1, p2]);
	assertEquals(adapter.queryCallCount, 1);
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

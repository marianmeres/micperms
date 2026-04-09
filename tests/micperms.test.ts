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

function createMockAdapter(opts?: {
	initialState?: MicPermissionStatus;
	supportsPermissions?: boolean;
	requestResult?: MicPermissionStatus;
}): MicPermsBrowserAdapter {
	const supportsPermissions = opts?.supportsPermissions ?? true;
	const initialState = opts?.initialState ?? "prompt";
	const requestResult = opts?.requestResult ?? "granted";

	return {
		queryPermission: () =>
			Promise.resolve(supportsPermissions ? initialState : null),
		requestPermission: () => Promise.resolve(requestResult),
		supportsPermissionsApi: () => supportsPermissions,
		onPermissionChange: () => null,
	};
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

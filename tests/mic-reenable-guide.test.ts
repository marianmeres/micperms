import { assert, assertEquals } from "@std/assert";
import {
	createMicReenableGuideController,
	type MicReenableGuideStep,
} from "../src/mic-reenable-guide.ts";

const STEPS: MicReenableGuideStep[] = [
	{ text: "one" },
	{ text: "two" },
	{ text: "three" },
];

Deno.test("controller: resolves config + initial snapshot", () => {
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	const s = c.get();
	assertEquals(s.index, 0);
	assertEquals(s.total, 3);
	assert(s.isFirst);
	assert(!s.isLast);
	assertEquals(s.flavor, "desktop");
	assertEquals(s.lang, "en");
	assertEquals(s.step.text, "one");
	assert(!s.hasOpenSettingsCta);
});

Deno.test("controller: next/back/goto clamp", () => {
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	c.back();
	assertEquals(c.index, 0); // clamp low
	c.next();
	assertEquals(c.index, 1);
	c.next();
	c.next();
	assertEquals(c.index, 2); // clamp high
	assert(c.get().isLast);
	c.goto(0);
	assertEquals(c.index, 0);
	c.goto(99);
	assertEquals(c.index, 2);
});

Deno.test("controller: subscribe fires immediately, on change, never after unsub", () => {
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	const seen: number[] = [];
	const unsub = c.subscribe((s) => seen.push(s.index));
	assertEquals(seen, [0]); // immediate
	c.next();
	assertEquals(seen, [0, 1]);
	c.goto(1); // no actual change → no fire
	assertEquals(seen, [0, 1]);
	unsub();
	c.next();
	assertEquals(seen, [0, 1]); // silent after unsub
});

Deno.test("controller: done/openSettings invoke callbacks + settings CTA flag", () => {
	let done = 0;
	let settings = 0;
	const c = createMicReenableGuideController({
		flavor: "ios-webview",
		lang: "en",
		steps: STEPS,
		onDone: () => done++,
		onOpenSettings: () => settings++,
	});
	// ios-webview + onOpenSettings → CTA applies
	assert(c.get().hasOpenSettingsCta);
	c.done();
	assertEquals(done, 1);
	c.openSettings();
	assertEquals(settings, 1);
});

Deno.test("controller: settings CTA requires the onOpenSettings callback", () => {
	const c = createMicReenableGuideController({
		flavor: "ios-webview",
		lang: "en",
		steps: STEPS,
	});
	assert(!c.get().hasOpenSettingsCta);
});

Deno.test("controller: generates default steps when none provided", () => {
	const c = createMicReenableGuideController({ flavor: "desktop", lang: "en" });
	const s = c.get();
	assertEquals(s.total, 3); // desktop ships 3 default steps
	assert(s.title.length > 0);
	assert(typeof s.step.art === "string");
});

Deno.test("controller: empty steps throws", () => {
	let threw = false;
	try {
		createMicReenableGuideController({ flavor: "desktop", lang: "en", steps: [] });
	} catch {
		threw = true;
	}
	assert(threw);
});

Deno.test("controller: destroy stops notifications", () => {
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	const seen: number[] = [];
	c.subscribe((s) => seen.push(s.index));
	c.destroy();
	c.next();
	assertEquals(seen, [0]); // only the immediate fire; destroy() froze it
});

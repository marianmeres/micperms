import { assert, assertEquals } from "@std/assert";
import {
	createMicReenableGuideController,
	defaultStepsFor,
	type MicReenableGuideFlavor,
	type MicReenableGuideStep,
	type MicReenableGuideStepsBuilderContext,
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

// ---------------------------------------------------------------------------
// Per-flavor step text override — `steps` builder, `stepText` map, header
// builders, exported `defaultStepsFor`.
// ---------------------------------------------------------------------------

Deno.test("defaultStepsFor: returns built-in copy + art per flavor/lang", () => {
	const en = defaultStepsFor("desktop", "en");
	assertEquals(en.length, 3); // desktop ships 3 steps
	assert(typeof en[0].art === "string");
	assert((en[0].art as string).includes("<svg"));
	assert(en[0].text.length > 0);

	// webview ships a different step count + art set
	assertEquals(defaultStepsFor("ios-webview", "en").length, 2);

	// switching language changes the copy, never the art
	const sk = defaultStepsFor("desktop", "sk");
	assertEquals(sk.length, 3);
	assertEquals(sk[0].art, en[0].art); // same art string
	assert(sk[0].text !== en[0].text); // different copy

	// a fresh array of fresh step objects is returned each call: mutating one
	// call's result must not leak into another (the documented mutate-safe
	// contract the `steps` builder relies on when consumers spread/edit).
	const a = defaultStepsFor("desktop", "en");
	const b = defaultStepsFor("desktop", "en");
	assert(a !== b); // distinct arrays
	assert(a[0] !== b[0]); // distinct step objects
	a[0].text = "MUTATED";
	assert(b[0].text !== "MUTATED"); // isolated
});

Deno.test("steps builder: overrides text, keeps built-in art", () => {
	let seenFlavor: string | undefined;
	let seenLang: string | undefined;
	let seenDefaultArt: unknown;
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: (ctx: MicReenableGuideStepsBuilderContext) => {
			seenFlavor = ctx.flavor;
			seenLang = ctx.lang;
			seenDefaultArt = ctx.defaultSteps[0].art;
			return ctx.defaultSteps.map((s, i) => ({ ...s, text: `custom ${i}` }));
		},
	});
	const s = c.get();
	assertEquals(s.total, 3);
	assertEquals(s.steps.map((x) => x.text), ["custom 0", "custom 1", "custom 2"]);
	// art preserved from the defaults
	assertEquals(s.steps[0].art, defaultStepsFor("desktop", "en")[0].art);
	// ctx carried resolved values + art-bearing defaults
	assertEquals(seenFlavor, "desktop");
	assertEquals(seenLang, "en");
	assert(typeof seenDefaultArt === "string");
});

Deno.test('steps builder: receives a concrete lang, never "auto"', () => {
	let seenLang: unknown;
	createMicReenableGuideController({
		flavor: "desktop",
		lang: "auto",
		steps: (ctx) => {
			seenLang = ctx.lang;
			return ctx.defaultSteps;
		},
	});
	assert(seenLang === "en" || seenLang === "sk");
});

Deno.test("steps builder: branches on flavor (browser text vs webview defaults)", () => {
	const BROWSER = ["b0", "b1", "b2"];
	const isBrowser = (f: MicReenableGuideFlavor) =>
		f === "desktop" || f === "ios-safari" || f === "android-chrome";
	const make = (flavor: MicReenableGuideFlavor) =>
		createMicReenableGuideController({
			flavor,
			lang: "sk",
			steps: (ctx) =>
				isBrowser(ctx.flavor)
					? ctx.defaultSteps.map((s, i) => ({
						...s,
						text: BROWSER[i] ?? s.text,
					}))
					: ctx.defaultSteps,
		});
	// browser flavor → overridden text, art kept
	const d = make("desktop").get();
	assertEquals(d.steps.map((x) => x.text), ["b0", "b1", "b2"]);
	assert(typeof d.steps[0].art === "string");
	// webview flavor → library defaults untouched (different count + art)
	const w = make("ios-webview").get();
	assertEquals(w.total, 2);
	assertEquals(
		w.steps.map((x) => x.text),
		defaultStepsFor("ios-webview", "sk").map((x) => x.text),
	);
});

Deno.test("steps builder: a changed step count drives total/last/clamp", () => {
	// grow: 3 desktop defaults → 4 steps
	const grown = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: (ctx) => [...ctx.defaultSteps, { text: "extra" }],
	});
	assertEquals(grown.get().total, 4);
	grown.goto(99);
	assertEquals(grown.index, 3); // clamps to the builder's count, not the defaults'
	assert(grown.get().isLast);
	assertEquals(grown.get().step.text, "extra");

	// shrink: 3 desktop defaults → 2 steps
	const shrunk = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: (ctx) => ctx.defaultSteps.slice(0, 2),
	});
	assertEquals(shrunk.get().total, 2);
	shrunk.goto(99);
	assertEquals(shrunk.index, 1);
	assert(shrunk.get().isLast);
});

Deno.test("steps array: full replace, no art injected", () => {
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: [{ text: "only" }],
	});
	const s = c.get();
	assertEquals(s.total, 1);
	assertEquals(s.step.text, "only");
	assertEquals(s.step.art, undefined); // array form does NOT inject art
});

Deno.test("steps builder: returning an empty array throws", () => {
	let threw = false;
	try {
		createMicReenableGuideController({
			flavor: "desktop",
			lang: "en",
			steps: () => [],
		});
	} catch {
		threw = true;
	}
	assert(threw);
});

Deno.test("steps builder: returning a non-array throws", () => {
	let threw = false;
	try {
		createMicReenableGuideController({
			flavor: "desktop",
			lang: "en",
			// deno-lint-ignore no-explicit-any
			steps: (() => null) as any,
		});
	} catch {
		threw = true;
	}
	assert(threw);
});

Deno.test("stepText: merges text by index, preserves art, null/undefined keeps default", () => {
	const defaults = defaultStepsFor("desktop", "en");
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		stepText: { desktop: ["brand 0", null, undefined] },
	});
	const s = c.get();
	assertEquals(s.total, 3);
	assertEquals(s.steps[0].text, "brand 0");
	assertEquals(s.steps[1].text, defaults[1].text); // null → keep
	assertEquals(s.steps[2].text, defaults[2].text); // undefined → keep
	// art always preserved
	assertEquals(s.steps[0].art, defaults[0].art);
	assertEquals(s.steps[1].art, defaults[1].art);
});

Deno.test("stepText: extra entries past the default count are clamped", () => {
	const c = createMicReenableGuideController({
		flavor: "ios-webview", // 2 default steps
		lang: "en",
		stepText: { "ios-webview": ["a", "b", "c", "d"] },
	});
	const s = c.get();
	assertEquals(s.total, 2); // clamped to the default count
	assertEquals(s.steps.map((x) => x.text), ["a", "b"]);
});

Deno.test("stepText: a missing flavor key leaves defaults untouched", () => {
	const defaults = defaultStepsFor("desktop", "en");
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		stepText: { "ios-safari": ["x", "y", "z"] }, // not the active flavor
	});
	assertEquals(
		c.get().steps.map((x) => x.text),
		defaults.map((x) => x.text),
	);
});

Deno.test("steps wins over stepText when both are provided", () => {
	// array form
	const a = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: [{ text: "from steps" }],
		stepText: { desktop: ["from stepText", "x", "y"] },
	});
	assertEquals(a.get().total, 1);
	assertEquals(a.get().step.text, "from steps");
	// builder form
	const b = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		steps: (ctx) => ctx.defaultSteps.map((s) => ({ ...s, text: "B" })),
		stepText: { desktop: ["from stepText", "x", "y"] },
	});
	assertEquals(b.get().steps.map((x) => x.text), ["B", "B", "B"]);
});

Deno.test("title/subtitle builders: flavor-aware + receive defaultText", () => {
	let seenDefault: string | undefined;
	const c = createMicReenableGuideController({
		flavor: "android-webview",
		lang: "en",
		title: (ctx) => `T:${ctx.flavor}`,
		subtitle: (ctx) => {
			seenDefault = ctx.defaultText;
			return `S:${ctx.lang}`;
		},
	});
	const s = c.get();
	assertEquals(s.title, "T:android-webview");
	assertEquals(s.subtitle, "S:en");
	// defaultText is the built-in chrome subtitle (non-empty)
	assert(typeof seenDefault === "string" && seenDefault.length > 0);
});

Deno.test("title string: plain override still wins over the translation", () => {
	const c = createMicReenableGuideController({
		flavor: "desktop",
		lang: "en",
		title: "Custom Title",
	});
	assertEquals(c.get().title, "Custom Title");
});

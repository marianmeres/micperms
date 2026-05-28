import { detectPlatform, type MicPlatformContext } from "./micperms.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * UI flavor — more specific than {@linkcode MicPlatformContext}. Splits
 * `browser` and `pwa` into iOS/Android/desktop buckets so the step copy can
 * reflect the actual OS the user is looking at.
 */
export type MicReenableGuideFlavor =
	| "ios-safari"
	| "android-chrome"
	| "desktop"
	| "ios-webview"
	| "android-webview"
	| "ios-pwa"
	| "android-pwa";

/**
 * Built-in language codes for the guide. More can be added later without a
 * breaking change.
 */
export type MicReenableGuideLang = "en" | "sk";

/** All language codes the guide ships translations for. */
export const MIC_REENABLE_GUIDE_LANGS: readonly MicReenableGuideLang[] = [
	"en",
	"sk",
];

/** A single tutorial step. */
export interface MicReenableGuideStep {
	/** Step copy. HTML allowed — treated as trusted (consumer-supplied). */
	text: string;
	/** Optional illustration. Either inline SVG markup or an SVG element. */
	art?: string | SVGElement;
}

// ---------------------------------------------------------------------------
// Slot types — vanilla equivalent of Svelte snippets / React render props.
// Each slot is `(ctx) => Node | string | void`. Returning a Node mounts it
// as-is, a string is rendered as trusted HTML (matches `step.text`'s
// contract), and nothing (`void` / `undefined` / `null`) falls back to the
// built-in chrome. Slots are called on every render, so they re-run on
// step changes.
// ---------------------------------------------------------------------------

/** Context passed to all slots. */
export interface MicReenableGuideRenderContext {
	/** 0-based current step index. */
	index: number;
	/** Total number of steps. */
	total: number;
	isFirst: boolean;
	isLast: boolean;
	/** The current step (text + art). */
	step: MicReenableGuideStep;
	flavor: MicReenableGuideFlavor;
	lang: MicReenableGuideLang;
	title: string;
	subtitle: string;
	labels: {
		back: string;
		next: string;
		done: string;
		openSettings: string;
	};
	/** Whether the platform-specific "Open Settings" CTA applies on step 0. */
	hasOpenSettingsCta: boolean;
	/** Advance one step (clamped). */
	next(): void;
	/** Go back one step (clamped). */
	back(): void;
	/** Jump to a step (clamped). */
	goto(i: number): void;
	/** Fires `onDone`. */
	done(): void;
	/** Fires `onOpenSettings` (if provided). */
	openSettings(): void;
}

/** Context for the per-button slot. */
export interface MicReenableGuideButtonContext
	extends MicReenableGuideRenderContext {
	/** Which logical button this is. */
	role: "back" | "next" | "done" | "open-settings";
	/** Resolved label for this role. */
	label: string;
	/** Whether this button should be disabled (only `back` on step 0). */
	disabled: boolean;
	/** Pre-wired click handler — triggers the normal behavior for this role. */
	onClick(): void;
}

/** A slot returns markup, a node, or nothing (= use default). */
export type MicReenableGuideSlot<
	C = MicReenableGuideRenderContext,
> = (ctx: C) => Node | string | null | undefined | void;

/** Optional render overrides. Each is called on every render. */
export interface MicReenableGuideSlots {
	/** Replace the title + subtitle block. */
	header?: MicReenableGuideSlot;
	/** Replace the illustration. */
	art?: MicReenableGuideSlot;
	/** Replace the step body (number + text). */
	step?: MicReenableGuideSlot;
	/**
	 * Replace an individual button. Called once per visible button per render.
	 * Return `void` to keep the default chrome for that button only.
	 */
	button?: MicReenableGuideSlot<MicReenableGuideButtonContext>;
	/**
	 * Replace the entire footer (the row of buttons). When set, `button` is
	 * not consulted — you own the whole row.
	 */
	footer?: MicReenableGuideSlot;
}

/** Configuration for {@linkcode createMicReenableGuide}. */
export interface MicReenableGuideOptions {
	/** Parent element. Required — the guide is appended to this node. */
	container: HTMLElement;

	/**
	 * Override {@linkcode MicPlatformContext} detection (forwarded to
	 * {@linkcode detectPlatform}).
	 */
	platform?: MicPlatformContext;
	/**
	 * Override flavor detection directly. Takes precedence over
	 * {@linkcode MicReenableGuideOptions.platform}.
	 */
	flavor?: MicReenableGuideFlavor;

	/**
	 * Built-in translation to use. Defaults to `"auto"`, which reads the
	 * primary subtag of `navigator.language` and falls back to `"en"` if no
	 * built-in match is found. Explicit {@linkcode title} /
	 * {@linkcode subtitle} / {@linkcode labels} / {@linkcode steps} always
	 * override the picked translation.
	 */
	lang?: MicReenableGuideLang | "auto";

	/** Replace the auto-generated step list entirely. */
	steps?: MicReenableGuideStep[];

	/** Override the header title. */
	title?: string;
	/** Override the header subtitle. */
	subtitle?: string;

	/**
	 * Theme. `"auto"` (default) reads
	 * `document.documentElement.classList.contains("dark")` on mount and
	 * reacts to live changes via a `MutationObserver`.
	 */
	theme?: "auto" | "light" | "dark";
	/** Accent color override (any CSS color). */
	accent?: string;

	/** Localized button labels. */
	labels?: {
		back?: string;
		next?: string;
		done?: string;
		openSettings?: string;
	};

	/**
	 * If provided, an "Open Settings" CTA is rendered on the first step
	 * for `ios-webview` / `android-webview` / `ios-pwa` / `android-pwa`
	 * flavors. Typically wired to `mic.openSettings()`.
	 */
	onOpenSettings?: () => void;
	/** Called when the user presses **Done** on the last step. */
	onDone?: () => void;

	/**
	 * Slot overrides — supply render functions for the regions you want to
	 * customize. Anything not provided falls back to the built-in chrome.
	 * See {@linkcode MicReenableGuideSlots}.
	 */
	slots?: MicReenableGuideSlots;
}

/** Public API returned by {@linkcode createMicReenableGuide}. */
export interface MicReenableGuide {
	/** Root element (already appended to the configured container). */
	readonly el: HTMLElement;
	/** Current step index (0-based). */
	readonly index: number;
	/** Advance to the next step (no-op past the last step). */
	next(): void;
	/** Go back one step (no-op on the first step). */
	back(): void;
	/** Jump to a specific step. Clamps to `[0, steps.length - 1]`. */
	goto(i: number): void;
	/** Switch theme. */
	setTheme(theme: "auto" | "light" | "dark"): void;
	/**
	 * Remove the root from the DOM and disconnect the theme observer.
	 * Idempotent. The shared `<style>` tag is left in place.
	 */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Flavor detection
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

function isIOSUserAgent(ua: string): boolean {
	if (/iPad|iPhone|iPod/.test(ua)) return true;
	// iPadOS 13+ reports MacIntel — disambiguate via touch points.
	try {
		if (
			_g.navigator?.platform === "MacIntel" &&
			typeof _g.navigator?.maxTouchPoints === "number" &&
			_g.navigator.maxTouchPoints > 1
		) {
			return true;
		}
	} catch {
		// ignore
	}
	return false;
}

function isAndroidUserAgent(ua: string): boolean {
	return /android/i.test(ua);
}

/**
 * Resolve a {@linkcode MicReenableGuideFlavor}. If `opts.flavor` is set, it
 * is returned as-is. Otherwise platform is resolved via
 * {@linkcode detectPlatform} and combined with a UA sniff to pick the right
 * bucket.
 */
export function detectFlavor(opts: {
	platform?: MicPlatformContext;
	flavor?: MicReenableGuideFlavor;
	userAgent?: string;
} = {}): MicReenableGuideFlavor {
	if (opts.flavor) return opts.flavor;

	const platform = detectPlatform({ platform: opts.platform });
	const ua = opts.userAgent ?? (_g.navigator?.userAgent ?? "");

	if (platform === "ios-webview") return "ios-webview";
	if (platform === "android-webview") return "android-webview";

	const ios = isIOSUserAgent(ua);
	const android = isAndroidUserAgent(ua);

	if (platform === "pwa") {
		if (ios) return "ios-pwa";
		if (android) return "android-pwa";
		return "desktop";
	}

	// platform === "browser"
	if (ios) return "ios-safari";
	if (android) return "android-chrome";
	return "desktop";
}

// ---------------------------------------------------------------------------
// Default step content per flavor
// ---------------------------------------------------------------------------

const ART = {
	addressbarIOS:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="40" y="58" width="240" height="42" rx="11" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="51" y="65" width="28" height="28" rx="7" fill="var(--mpg-accent-soft)"/>
			<rect x="58" y="71" width="14" height="16" rx="2.2" fill="none" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="61" y1="76" x2="69" y2="76" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
			<line x1="61" y1="80" x2="69" y2="80" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
			<line x1="61" y1="84" x2="66" y2="84" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
		</g>
		<rect x="92" y="73" width="158" height="12" rx="6" fill="var(--mpg-art-soft)"/>
		<g transform="translate(259 72) scale(0.875)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M65 62 L65 48" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="65" cy="46" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
	addressbarAndroid:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="40" y="58" width="240" height="42" rx="11" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="51" y="65" width="28" height="28" rx="7" fill="var(--mpg-accent-soft)"/>
			<line x1="57" y1="73" x2="73" y2="73" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="68" cy="73" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="57" y1="79" x2="73" y2="79" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="60" cy="79" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="57" y1="85" x2="73" y2="85" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="65" cy="85" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
		</g>
		<rect x="92" y="73" width="158" height="12" rx="6" fill="var(--mpg-art-soft)"/>
		<g transform="translate(259 72) scale(0.875)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M65 62 L65 48" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="65" cy="46" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
	addressbarDesktop:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="28" y="22" width="264" height="92" rx="10" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<line x1="28" y1="48" x2="292" y2="48" stroke="var(--mpg-line)"/>
		<circle cx="44" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<circle cx="58" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<circle cx="72" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<rect x="44" y="66" width="232" height="32" rx="8" fill="var(--mpg-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="52" y="72" width="24" height="20" rx="5" fill="var(--mpg-accent-soft)"/>
			<path d="M59 81 v-3 a5 5 0 0 1 10 0 v3" fill="none" stroke="var(--mpg-accent)" stroke-width="1.5"/>
			<rect x="57" y="81" width="14" height="9" rx="1.6" fill="var(--mpg-accent)"/>
		</g>
		<rect x="86" y="77" width="170" height="10" rx="5" fill="var(--mpg-art-soft)"/>
		<g transform="translate(260 76) scale(0.75)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M64 100 L64 118" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="64" cy="121" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
	menu:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="78" y="22" width="164" height="114" rx="14" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<rect x="94" y="40" width="100" height="9" rx="4.5" fill="var(--mpg-art-soft)"/>
		<rect x="94" y="66" width="120" height="9" rx="4.5" fill="var(--mpg-art-soft)"/>
		<rect x="86" y="86" width="148" height="30" rx="8" fill="var(--mpg-accent-soft)" class="mpg-pulse"/>
		<rect x="94" y="96" width="96" height="10" rx="5" fill="var(--mpg-accent)"/>
		<path d="M214 101l5 5 9-10" stroke="var(--mpg-accent)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`,
	toggle:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="58" y="56" width="204" height="46" rx="12" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<rect x="74" y="74" width="86" height="10" rx="5" fill="var(--mpg-fg)"/>
		<rect x="196" y="69" width="52" height="20" rx="10" fill="#34c759" class="mpg-pulse"/>
		<circle cx="238" cy="79" r="8.5" fill="#fff"/>
	</svg>`,
	gear:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="110" y="34" width="100" height="100" rx="22" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g transform="translate(160 84)">
			<g class="mpg-pulse">
				<path transform="scale(3.75) translate(-8 -8)" fill="var(--mpg-accent)" fill-rule="evenodd" d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
			</g>
		</g>
	</svg>`,
} as const;

// ---------------------------------------------------------------------------
// Default content tables — art and translated step text are kept separate
// so adding a language only means adding strings, not duplicating SVGs.
// ---------------------------------------------------------------------------

const FLAVOR_ART: Record<MicReenableGuideFlavor, readonly string[]> = {
	"ios-safari": [ART.addressbarIOS, ART.menu, ART.toggle],
	"android-chrome": [ART.addressbarAndroid, ART.menu, ART.toggle],
	"desktop": [ART.addressbarDesktop, ART.menu, ART.toggle],
	"ios-webview": [ART.gear, ART.toggle],
	"android-webview": [ART.gear, ART.toggle],
	"ios-pwa": [ART.gear, ART.toggle],
	"android-pwa": [ART.gear, ART.menu, ART.toggle],
};

interface ChromeTexts {
	title: string;
	subtitle: string;
	back: string;
	next: string;
	done: string;
	openSettings: string;
}

const CHROME_TEXTS: Record<MicReenableGuideLang, ChromeTexts> = {
	en: {
		title: "Re-enable the microphone",
		subtitle:
			"Microphone access is off. A few quick taps in your device settings turns it back on.",
		back: "Back",
		next: "Next",
		done: "Done",
		openSettings: "Open Settings",
	},
	sk: {
		title: "Povoliť mikrofón",
		subtitle:
			"Prístup k mikrofónu je vypnutý. Stačí pár klikov v nastaveniach zariadenia a znova ho zapnete.",
		back: "Späť",
		next: "Ďalej",
		done: "Hotovo",
		openSettings: "Otvoriť nastavenia",
	},
};

const STEP_TEXTS: Record<
	MicReenableGuideLang,
	Record<MicReenableGuideFlavor, readonly string[]>
> = {
	en: {
		"ios-safari": [
			"Tap the <b>page settings</b> icon at the left of the address bar.",
			"Choose <b>Website Settings</b>.",
			"Set <b>Microphone</b> to <b>Allow</b>, then reload the page.",
		],
		"android-chrome": [
			"Tap the <b>site info</b> icon at the left of the address bar.",
			"Open <b>Permissions</b>.",
			"Allow <b>Microphone</b>, then reload the page.",
		],
		"desktop": [
			"Click the <b>site info</b> icon in the address bar.",
			"Find <b>Microphone</b> in the permissions list.",
			"Set it to <b>Allow</b>, then reload the page.",
		],
		"ios-webview": [
			"Open the <b>Settings</b> app.",
			"Find this app and turn <b>Microphone</b> on.",
		],
		"android-webview": [
			"Open this app's <b>Settings</b>.",
			"Under <b>Permissions</b>, allow <b>Microphone</b>.",
		],
		"ios-pwa": [
			"Open <b>Settings → Apps → [this app]</b>.",
			"Turn <b>Microphone</b> on.",
		],
		"android-pwa": [
			"Open the device <b>Settings</b>.",
			"Go to <b>Apps → [this app] → Permissions</b>.",
			"Allow <b>Microphone</b>.",
		],
	},
	sk: {
		"ios-safari": [
			"Ťuknite na ikonu <b>nastavení stránky</b> vľavo od adresového riadku.",
			"Zvoľte <b>Nastavenia webovej stránky</b>.",
			"Nastavte <b>Mikrofón</b> na <b>Povoliť</b> a obnovte stránku.",
		],
		"android-chrome": [
			"Ťuknite na ikonu <b>info o stránke</b> vľavo od adresového riadku.",
			"Otvorte <b>Povolenia</b>.",
			"Povoľte <b>Mikrofón</b> a obnovte stránku.",
		],
		"desktop": [
			"Kliknite na ikonu <b>info o stránke</b> v adresovom riadku.",
			"Nájdite <b>Mikrofón</b> v zozname povolení.",
			"Nastavte ho na <b>Povoliť</b> a obnovte stránku.",
		],
		"ios-webview": [
			"Otvorte aplikáciu <b>Nastavenia</b>.",
			"Nájdite túto aplikáciu a zapnite <b>Mikrofón</b>.",
		],
		"android-webview": [
			"Otvorte <b>Nastavenia</b> tejto aplikácie.",
			"V sekcii <b>Povolenia</b> povoľte <b>Mikrofón</b>.",
		],
		"ios-pwa": [
			"Otvorte <b>Nastavenia → Aplikácie → [táto aplikácia]</b>.",
			"Zapnite <b>Mikrofón</b>.",
		],
		"android-pwa": [
			"Otvorte <b>Nastavenia</b> zariadenia.",
			"Prejdite na <b>Aplikácie → [táto aplikácia] → Povolenia</b>.",
			"Povoľte <b>Mikrofón</b>.",
		],
	},
};

/**
 * Resolve a {@linkcode MicReenableGuideLang}. If `input` is an explicit
 * supported code, returns it. If `"auto"` or omitted, reads
 * `navigator.language`'s primary subtag and matches against the built-in
 * table. Falls back to `"en"`.
 */
function resolveLang(
	input?: MicReenableGuideLang | "auto",
): MicReenableGuideLang {
	if (input && input !== "auto") {
		return input in STEP_TEXTS ? input : "en";
	}
	try {
		const tag = (_g.navigator?.language ?? "en").toLowerCase();
		const primary = tag.split("-")[0];
		if (primary in STEP_TEXTS) return primary as MicReenableGuideLang;
	} catch {
		// ignore
	}
	return "en";
}

function defaultStepsFor(
	flavor: MicReenableGuideFlavor,
	lang: MicReenableGuideLang,
): MicReenableGuideStep[] {
	const arts = FLAVOR_ART[flavor];
	const texts = STEP_TEXTS[lang][flavor];
	return texts.map((text, i) => ({ text, art: arts[i] }));
}

const FLAVORS_WITH_SETTINGS_CTA: ReadonlySet<MicReenableGuideFlavor> = new Set([
	"ios-webview",
	"android-webview",
	"ios-pwa",
	"android-pwa",
]);

// ---------------------------------------------------------------------------
// Styles (injected once into document head)
// ---------------------------------------------------------------------------

const STYLE_ID = "mpg-styles";

const STYLE_CSS = `
.mpg {
	--mpg-bg: #ffffff;
	--mpg-fg: #1c1c1e;
	--mpg-muted: #8a8a8e;
	--mpg-accent: #007aff;
	--mpg-accent-soft: #007aff1a;
	--mpg-line: #e5e5ea;
	--mpg-art-bg: #f7f7fa;
	--mpg-art-soft: #e8e8ed;
	--mpg-radius: 16px;
	--mpg-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;

	width: 340px; max-width: 100%;
	background: var(--mpg-bg); color: var(--mpg-fg);
	border-radius: var(--mpg-radius);
	box-shadow: 0 12px 40px -8px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.04);
	overflow: hidden; font-family: var(--mpg-font);
	-webkit-font-smoothing: antialiased;
}
.mpg[data-theme="dark"] {
	--mpg-bg: #1c1c1e;
	--mpg-fg: #f2f2f7;
	--mpg-muted: #8e8e93;
	--mpg-line: #38383a;
	--mpg-art-bg: #2c2c2e;
	--mpg-art-soft: #3a3a3c;
	box-shadow: 0 12px 40px -8px rgba(0,0,0,.6), 0 0 0 .5px rgba(255,255,255,.06);
}
.mpg__head { padding: 20px 20px 4px; }
.mpg__title { font-size: 18px; font-weight: 600; letter-spacing: -.01em; margin: 0; }
.mpg__sub { font-size: 13.5px; color: var(--mpg-muted); margin: 6px 0 0; line-height: 1.45; }
.mpg__stage { padding: 14px 20px 4px; }
.mpg__art {
	height: 158px; border-radius: 12px; background: var(--mpg-art-bg);
	border: 1px solid var(--mpg-line); display: grid; place-items: center;
	overflow: hidden; position: relative;
}
.mpg__art svg { width: 100%; height: 100%; }
.mpg__step { padding: 14px 20px 4px; }
.mpg__step-default { display: flex; gap: 10px; align-items: flex-start; }
.mpg__num {
	flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
	background: var(--mpg-accent); color: #fff; font-size: 12.5px; font-weight: 600;
	display: grid; place-items: center; margin-top: 1px;
}
.mpg__text { font-size: 14.5px; line-height: 1.5; }
.mpg__text b { font-weight: 600; }
.mpg__dots { display: flex; gap: 6px; justify-content: center; padding: 14px 0 4px; }
.mpg__dot {
	width: 6px; height: 6px; border-radius: 50%; background: var(--mpg-line);
	transition: background .2s, width .2s;
}
.mpg__dot--on { background: var(--mpg-accent); width: 18px; border-radius: 3px; }
.mpg__foot { padding: 12px 20px 18px; }
.mpg__foot-default { display: flex; gap: 10px; }
.mpg__btn {
	flex: 1; height: 44px; border-radius: 11px; border: 0; cursor: pointer;
	font-family: inherit; font-size: 15px; font-weight: 600;
	transition: opacity .15s, transform .05s;
}
.mpg__btn:active { transform: scale(.985); }
.mpg__btn--ghost { background: transparent; color: var(--mpg-accent); }
.mpg__btn--ghost:disabled { color: var(--mpg-muted); opacity: .4; cursor: default; }
.mpg__btn--solid { background: var(--mpg-accent); color: #fff; }
.mpg-pulse {
	transform-box: fill-box; transform-origin: center;
	animation: mpgPulse 1.6s ease-in-out infinite;
}
@keyframes mpgPulse {
	0%, 100% { opacity: .35; transform: scale(1); }
	50% { opacity: 1; transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
	.mpg-pulse { animation: none; opacity: 1; }
}
`;

function ensureStyles(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE_CSS;
	document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a mic re-enable guide. Mounts a self-contained, framework-agnostic
 * multi-step tutorial into the configured container and returns a handle for
 * controlling it programmatically.
 *
 * Step copy auto-tailors to the detected {@linkcode MicReenableGuideFlavor}
 * (override via `flavor` or `steps`). Theme defaults to `"auto"` which mirrors
 * `document.documentElement.classList.contains("dark")` live.
 */
export function createMicReenableGuide(
	opts: MicReenableGuideOptions,
): MicReenableGuide {
	if (!opts?.container) {
		throw new Error(
			"createMicReenableGuide: `container` is required",
		);
	}
	if (typeof document === "undefined") {
		throw new Error(
			"createMicReenableGuide: requires a DOM environment",
		);
	}

	ensureStyles();

	const flavor = detectFlavor({
		platform: opts.platform,
		flavor: opts.flavor,
	});

	const lang = resolveLang(opts.lang);
	const chrome = CHROME_TEXTS[lang];

	const steps = opts.steps ?? defaultStepsFor(flavor, lang);
	if (steps.length === 0) {
		throw new Error("createMicReenableGuide: `steps` must not be empty");
	}

	const title = opts.title ?? chrome.title;
	const subtitle = opts.subtitle ?? chrome.subtitle;
	const labels = {
		back: opts.labels?.back ?? chrome.back,
		next: opts.labels?.next ?? chrome.next,
		done: opts.labels?.done ?? chrome.done,
		openSettings: opts.labels?.openSettings ?? chrome.openSettings,
	};

	const showSettingsCta = !!opts.onOpenSettings &&
		FLAVORS_WITH_SETTINGS_CTA.has(flavor);

	// --- build DOM ---

	const root = document.createElement("div");
	root.className = "mpg";
	root.lang = lang;
	if (opts.accent) root.style.setProperty("--mpg-accent", opts.accent);

	// Skeleton: each slot-able region is an empty host populated by the
	// render path (either a user slot or the built-in default).
	root.innerHTML = `
		<div class="mpg__head" data-head></div>
		<div class="mpg__stage"><div class="mpg__art" data-art></div></div>
		<div class="mpg__step" data-step></div>
		<div class="mpg__dots" data-dots></div>
		<div class="mpg__foot" data-foot></div>
	`;

	const $head = root.querySelector("[data-head]") as HTMLElement;
	const $art = root.querySelector("[data-art]") as HTMLElement;
	const $step = root.querySelector("[data-step]") as HTMLElement;
	const $dotsHost = root.querySelector("[data-dots]") as HTMLElement;
	const $foot = root.querySelector("[data-foot]") as HTMLElement;

	const dots = steps.map(() => {
		const d = document.createElement("span");
		d.className = "mpg__dot";
		$dotsHost.appendChild(d);
		return d;
	});

	const slots = opts.slots ?? {};

	let i = 0;
	let destroyed = false;
	let themeObserver: MutationObserver | null = null;

	function mountInto(
		host: HTMLElement,
		out: Node | string | null | undefined | void,
	): boolean {
		if (out == null) return false;
		host.replaceChildren();
		if (typeof out === "string") host.innerHTML = out;
		else host.appendChild(out as Node);
		return true;
	}

	function appendSlotOutput(host: HTMLElement, out: Node | string): void {
		if (typeof out === "string") {
			const tpl = document.createElement("template");
			tpl.innerHTML = out;
			host.appendChild(tpl.content);
		} else {
			host.appendChild(out);
		}
	}

	function buildCtx(): MicReenableGuideRenderContext {
		const isLast = i === steps.length - 1;
		return {
			index: i,
			total: steps.length,
			isFirst: i === 0,
			isLast,
			step: steps[i],
			flavor,
			lang,
			title,
			subtitle,
			labels,
			hasOpenSettingsCta: showSettingsCta,
			next() {
				if (destroyed) return;
				if (i < steps.length - 1) {
					i++;
					render();
				}
			},
			back() {
				if (destroyed) return;
				if (i > 0) {
					i--;
					render();
				}
			},
			goto(n: number) {
				if (destroyed) return;
				const clamped = Math.max(0, Math.min(steps.length - 1, n | 0));
				if (clamped !== i) {
					i = clamped;
					render();
				}
			},
			done() {
				opts.onDone?.();
			},
			openSettings() {
				opts.onOpenSettings?.();
			},
		};
	}

	function renderHeader(ctx: MicReenableGuideRenderContext): void {
		if (slots.header && mountInto($head, slots.header(ctx))) return;
		$head.replaceChildren();
		const h = document.createElement("h2");
		h.className = "mpg__title";
		h.textContent = ctx.title;
		const p = document.createElement("p");
		p.className = "mpg__sub";
		p.textContent = ctx.subtitle;
		$head.append(h, p);
	}

	function renderArt(ctx: MicReenableGuideRenderContext): void {
		if (slots.art && mountInto($art, slots.art(ctx))) return;
		$art.replaceChildren();
		const art = ctx.step.art;
		if (!art) return;
		if (typeof art === "string") $art.innerHTML = art;
		else $art.appendChild(art);
	}

	function renderStep(ctx: MicReenableGuideRenderContext): void {
		if (slots.step && mountInto($step, slots.step(ctx))) return;
		$step.replaceChildren();
		const wrap = document.createElement("div");
		wrap.className = "mpg__step-default";
		const num = document.createElement("div");
		num.className = "mpg__num";
		num.textContent = String(ctx.index + 1);
		const text = document.createElement("div");
		text.className = "mpg__text";
		text.innerHTML = ctx.step.text;
		wrap.append(num, text);
		$step.appendChild(wrap);
	}

	function buttonContexts(
		ctx: MicReenableGuideRenderContext,
	): MicReenableGuideButtonContext[] {
		const primaryRole: MicReenableGuideButtonContext["role"] =
			showSettingsCta && ctx.isFirst
				? "open-settings"
				: ctx.isLast
				? "done"
				: "next";
		const primaryLabel = primaryRole === "open-settings"
			? labels.openSettings
			: primaryRole === "done"
			? labels.done
			: labels.next;
		const primaryClick = () => {
			if (destroyed) return;
			if (primaryRole === "open-settings") {
				opts.onOpenSettings?.();
				// advance so the user sees the next step
				if (i < steps.length - 1) {
					i++;
					render();
				}
				return;
			}
			if (primaryRole === "done") {
				opts.onDone?.();
				return;
			}
			if (i < steps.length - 1) {
				i++;
				render();
			}
		};
		const backClick = () => {
			if (destroyed) return;
			if (i > 0) {
				i--;
				render();
			}
		};
		return [
			{
				...ctx,
				role: "back",
				label: labels.back,
				disabled: ctx.isFirst,
				onClick: backClick,
			},
			{
				...ctx,
				role: primaryRole,
				label: primaryLabel,
				disabled: false,
				onClick: primaryClick,
			},
		];
	}

	function renderDefaultButton(
		b: MicReenableGuideButtonContext,
	): HTMLButtonElement {
		const el = document.createElement("button");
		el.type = "button";
		el.className = b.role === "back"
			? "mpg__btn mpg__btn--ghost"
			: "mpg__btn mpg__btn--solid";
		el.textContent = b.label;
		el.disabled = b.disabled;
		el.dataset.role = b.role;
		el.addEventListener("click", b.onClick);
		return el;
	}

	function renderFooter(ctx: MicReenableGuideRenderContext): void {
		if (slots.footer && mountInto($foot, slots.footer(ctx))) return;
		$foot.replaceChildren();
		const wrap = document.createElement("div");
		wrap.className = "mpg__foot-default";
		for (const b of buttonContexts(ctx)) {
			if (slots.button) {
				const out = slots.button(b);
				if (out != null) {
					appendSlotOutput(wrap, out as Node | string);
					continue;
				}
			}
			wrap.appendChild(renderDefaultButton(b));
		}
		$foot.appendChild(wrap);
	}

	function render(): void {
		const ctx = buildCtx();
		renderHeader(ctx);
		renderArt(ctx);
		renderStep(ctx);
		dots.forEach((d, n) => d.classList.toggle("mpg__dot--on", n === i));
		renderFooter(ctx);
	}

	// --- theme ---

	function applyThemeAttr(isDark: boolean): void {
		root.dataset.theme = isDark ? "dark" : "light";
	}

	function resolveAuto(): boolean {
		try {
			return document.documentElement.classList.contains("dark");
		} catch {
			return false;
		}
	}

	function setTheme(theme: "auto" | "light" | "dark"): void {
		if (themeObserver) {
			themeObserver.disconnect();
			themeObserver = null;
		}
		if (theme === "auto") {
			applyThemeAttr(resolveAuto());
			if (typeof MutationObserver !== "undefined") {
				themeObserver = new MutationObserver(() => {
					applyThemeAttr(resolveAuto());
				});
				themeObserver.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["class"],
				});
			}
		} else {
			applyThemeAttr(theme === "dark");
		}
	}

	setTheme(opts.theme ?? "auto");
	render();
	opts.container.appendChild(root);

	const api: MicReenableGuide = {
		el: root,
		get index() {
			return i;
		},
		next() {
			if (destroyed) return;
			if (i < steps.length - 1) {
				i++;
				render();
			}
		},
		back() {
			if (destroyed) return;
			if (i > 0) {
				i--;
				render();
			}
		},
		goto(n: number) {
			if (destroyed) return;
			const clamped = Math.max(0, Math.min(steps.length - 1, n | 0));
			if (clamped !== i) {
				i = clamped;
				render();
			}
		},
		setTheme,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			if (themeObserver) {
				themeObserver.disconnect();
				themeObserver = null;
			}
			if (root.parentNode) root.parentNode.removeChild(root);
		},
	};

	return api;
}

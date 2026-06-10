<!--
	Approach (a): reskin the BUILT-IN guide via slots + CSS.

	Works against the published @marianmeres/micperms (>= 2.2) — no library
	changes required. Reuses flavor detection, step navigation, dots and the
	SVG art; only the chrome (header/step/footer) + a CSS override are custom.
	The close button lives in the `header` slot (the skin sets
	`.mpg { position: relative }` so it can sit top-right).

	This file is reference material — the micperms repo itself has no Svelte
	build. Copy it into a Svelte 5 app (e.g. `src/lib/`).
-->
<script module lang="ts">
	// Built-in desktop illustrations (address bar -> menu -> toggle), copied as
	// strings. They reference --mpg-* CSS vars set by the skin below + the
	// lib's own .mpg-pulse animation (present because we use the DOM factory).
	const ART_ADDRESSBAR =
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="28" y="22" width="264" height="92" rx="10" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/><line x1="28" y1="48" x2="292" y2="48" stroke="var(--mpg-line)"/><circle cx="44" cy="35" r="4" fill="var(--mpg-art-soft)"/><circle cx="58" cy="35" r="4" fill="var(--mpg-art-soft)"/><circle cx="72" cy="35" r="4" fill="var(--mpg-art-soft)"/><rect x="44" y="66" width="232" height="32" rx="8" fill="var(--mpg-bg)" stroke="var(--mpg-line)"/><g class="mpg-pulse"><rect x="52" y="72" width="24" height="20" rx="5" fill="var(--mpg-accent-soft)"/><path d="M59 81 v-3 a5 5 0 0 1 10 0 v3" fill="none" stroke="var(--mpg-accent)" stroke-width="1.5"/><rect x="57" y="81" width="14" height="9" rx="1.6" fill="var(--mpg-accent)"/></g><rect x="86" y="77" width="170" height="10" rx="5" fill="var(--mpg-art-soft)"/><path d="M64 100 L64 118" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/><circle cx="64" cy="121" r="3" fill="var(--mpg-accent)"/></svg>`;
	const ART_MENU =
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="78" y="22" width="164" height="114" rx="14" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/><rect x="94" y="40" width="100" height="9" rx="4.5" fill="var(--mpg-art-soft)"/><rect x="94" y="66" width="120" height="9" rx="4.5" fill="var(--mpg-art-soft)"/><rect x="86" y="86" width="148" height="30" rx="8" fill="var(--mpg-accent-soft)" class="mpg-pulse"/><rect x="94" y="96" width="96" height="10" rx="5" fill="var(--mpg-accent)"/><path d="M214 101l5 5 9-10" stroke="var(--mpg-accent)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
	const ART_TOGGLE =
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="58" y="56" width="204" height="46" rx="12" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/><rect x="74" y="74" width="86" height="10" rx="5" fill="var(--mpg-fg)"/><rect x="196" y="69" width="52" height="20" rx="10" fill="#34c759" class="mpg-pulse"/><circle cx="238" cy="79" r="8.5" fill="#fff"/></svg>`;

	const SKIN_ID = "mpg-skin-styles";
	const SKIN_CSS = `
.mpg-skin .mpg {
	width: 100%; max-width: 380px; position: relative;
	border-radius: 14px; border: 1px solid #e3e6ea;
	box-shadow: 0 1px 3px rgba(16,24,40,.06);
	font-family: "Inter", system-ui, -apple-system, sans-serif;
	--mpg-bg: #ffffff; --mpg-fg: #1d2433; --mpg-muted: #9aa1ad;
	--mpg-line: #e3e6ea; --mpg-art-bg: #f4f5f7; --mpg-art-soft: #dfe3e9;
	--mpg-accent-soft: color-mix(in srgb, var(--mpg-accent) 12%, transparent);
}
.mpg-skin .mpg__head { padding: 22px 22px 2px; }
.mpg-skin .skin-title { margin: 0; padding-right: 40px; font-size: 20px; font-weight: 700; letter-spacing: -.01em; color: var(--mpg-fg); }
.mpg-skin .skin-sub { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: #5b6472; }
.mpg-skin .skin-sub b { font-weight: 700; color: var(--mpg-fg); }
.mpg-skin .skin-close { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--mpg-accent); background: transparent; color: var(--mpg-accent); display: grid; place-items: center; cursor: pointer; padding: 0; line-height: 0; }
.mpg-skin .mpg__art { height: 150px; border-radius: 12px; }
.mpg-skin .mpg__step { padding: 16px 22px 2px; }
.mpg-skin .skin-caption { font-size: 14px; line-height: 1.55; color: #3b4350; }
.mpg-skin .skin-caption b { font-weight: 700; color: var(--mpg-fg); }
.mpg-skin .mpg__dots { padding: 18px 0 6px; gap: 7px; }
.mpg-skin .mpg__dot { width: 7px; height: 7px; border-radius: 50%; background: #cfd4db; transition: background .2s; }
.mpg-skin .mpg__dot--on { width: 7px; border-radius: 50%; background: #2b3240; }
.mpg-skin .mpg__foot { padding: 14px 22px 22px; }
.mpg-skin .skin-cta { width: 100%; height: 50px; border-radius: 10px; border: 1.5px solid var(--mpg-accent); background: transparent; color: var(--mpg-accent); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; transition: background .15s; }
.mpg-skin .skin-cta:hover { background: color-mix(in srgb, var(--mpg-accent) 8%, transparent); }
.mpg-skin .skin-cta:active { transform: scale(.99); }
`;

	function injectSkin(): void {
		if (typeof document === "undefined" || document.getElementById(SKIN_ID)) return;
		const style = document.createElement("style");
		style.id = SKIN_ID;
		style.textContent = SKIN_CSS;
		document.head.appendChild(style);
	}
</script>

<script lang="ts">
	import { onMount } from "svelte";
	import {
		createMicReenableGuide,
		type MicReenableGuideRenderContext,
	} from "@marianmeres/micperms/mic-reenable-guide";

	let {
		accent = "#0a7d54",
		onClose,
		onDone,
		onOpenSettings,
	}: {
		accent?: string;
		onClose?: () => void;
		onDone?: () => void;
		onOpenSettings?: () => void;
	} = $props();

	let host: HTMLDivElement;

	const STEPS = [
		{
			text: "Ťuknite na ikonu <b>Informácie</b> v riadku, kde sa zadáva webová adresa.",
			art: ART_ADDRESSBAR,
		},
		{ text: "Vyberte možnosť <b>Povolenia</b>.", art: ART_MENU },
		{ text: "<b>Povoľte mikrofón</b> a obnovte stránku.", art: ART_TOGGLE },
	];

	function header(ctx: MicReenableGuideRenderContext): Node {
		const wrap = document.createElement("div");
		const close = document.createElement("button");
		close.type = "button";
		close.className = "skin-close";
		close.setAttribute("aria-label", "Zavrieť");
		close.innerHTML =
			`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
		close.addEventListener("click", () => onClose?.());

		const h = document.createElement("h2");
		h.className = "skin-title";
		h.textContent = ctx.title;

		const p = document.createElement("p");
		p.className = "skin-sub";
		p.innerHTML = ctx.subtitle; // trusted (matches lib's text contract)

		wrap.append(close, h, p);
		return wrap;
	}

	function step(ctx: MicReenableGuideRenderContext): string {
		// caption only — no number badge
		return `<div class="skin-caption">${ctx.step.text}</div>`;
	}

	function footer(ctx: MicReenableGuideRenderContext): Node {
		const isSettings = ctx.hasOpenSettingsCta && ctx.isFirst;
		const label = isSettings
			? ctx.labels.openSettings
			: ctx.isLast
				? ctx.labels.done
				: ctx.labels.next;

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "skin-cta";
		btn.textContent = label;
		btn.addEventListener("click", () => {
			if (isSettings) {
				ctx.openSettings();
				ctx.next();
			} else if (ctx.isLast) {
				ctx.done();
			} else {
				ctx.next();
			}
		});
		return btn;
	}

	onMount(() => {
		injectSkin();
		const guide = createMicReenableGuide({
			container: host,
			accent,
			lang: "sk",
			title: "Povoľte používanie mikrofónu",
			subtitle:
				"Ak sa chcete s poradkyňou rozprávať, povoľte používanie mikrofónu v <b>nastaveniach prehliadača</b>.",
			labels: { next: "Ďalej", done: "Dokončiť" },
			steps: STEPS,
			onDone,
			onOpenSettings,
			slots: { header, step, footer },
		});
		return () => guide.destroy();
	});
</script>

<div bind:this={host} class="mpg-skin"></div>

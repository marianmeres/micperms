# Svelte examples — fully-custom look

Two reference components showing how to reskin the mic re-enable guide to a
brand design (the screenshots use a Dovera-style card: title + close button,
single full-width outlined CTA, dark-filled dots, green accent).

> ⚠️ Reference only. The micperms repo is Deno/vanilla and has **no Svelte
> build** — these `.svelte` files are not compiled or type-checked here. Copy
> the one you want into a Svelte 5 app (e.g. `src/lib/`). Both were validated
> with the Svelte autofixer.

## Which one?

| File | Approach | micperms version | When |
| ---- | -------- | ---------------- | ---- |
| [`MicReenableGuideSkinned.svelte`](./MicReenableGuideSkinned.svelte) | **(a)** Reskin the built-in DOM guide via `slots` (`header`/`step`/`footer`) + a CSS override, driven by `createMicReenableGuide`. | **>= 2.2** (no lib change) | You want the custom look with the least code and are fine authoring the chrome as DOM/HTML strings. Reuses the lib's navigation, dots and SVG art. |
| [`MicReenableGuide.svelte`](./MicReenableGuide.svelte) | **(b)** Fully native Svelte markup on top of the headless `createMicReenableGuideController`, bridged into runes with `fromStore`. | **>= 2.3** | You want to own 100% of the DOM (scoped CSS, design-system components) while keeping flavor detection, default copy and navigation. |

## Props (both)

- `accent?: string` — brand color (default `#0a7d54`, a placeholder green — set the real brand value).
- `onClose?`, `onDone?`, `onOpenSettings?` — callbacks.
- (b) also: `flavor?`, `lang?`, `steps?`, `title?`, `subtitle?`, `labels?` — forwarded to the controller.

## Notes

- Both hardcode the 3-step **browser** flow (address bar → menu → toggle) to
  match the Figma exactly. For WebView/PWA flavors either author per-flavor
  `steps`, or omit `steps` to let the lib generate flavor-correct content (at
  the cost of the lib's default copy instead of the exact Figma wording).
- `{@html}` / `innerHTML` on `step.text` and `subtitle` is intentional — the
  lib documents those as **trusted, consumer-supplied** HTML. Never feed them
  user input.

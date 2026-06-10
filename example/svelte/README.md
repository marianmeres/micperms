# Svelte examples — fully-custom look

Two reference components showing how to reskin the mic re-enable guide to a
brand design (the screenshots use a Dovera-style card: title + close button,
single full-width outlined CTA, dark-filled dots, green accent).

> ⚠️ Reference only. The micperms repo is Deno/vanilla and has **no Svelte
> build** — these `.svelte` files are not compiled or type-checked here. Copy
> the one you want into a Svelte 5 app (e.g. `src/lib/`). Both were validated
> with the Svelte autofixer.

## Which one?

| File                                                                 | Approach                                                                                                                                                             | micperms version                                            | When                                                                                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`MicReenableGuideSkinned.svelte`](./MicReenableGuideSkinned.svelte) | **(a)** Reskin the built-in DOM guide via `slots` (`header`/`step`/`footer`) + a CSS override, driven by `createMicReenableGuide`. Brand copy via a `steps` builder. | **>= 2.4** (slots-only reskin works on >= 2.2)              | You want the custom look with the least code and are fine authoring the chrome as DOM/HTML strings. Reuses the lib's navigation, dots and **flavor-correct SVG art**. |
| [`MicReenableGuide.svelte`](./MicReenableGuide.svelte)               | **(b)** Fully native Svelte markup on top of the headless `createMicReenableGuideController`, bridged into runes with `fromStore`.                                   | **>= 2.3** (builder/`stepText`/header-builder props >= 2.4) | You want to own 100% of the DOM (scoped CSS, design-system components) while keeping flavor detection, default copy and navigation.                                   |

## Props (both)

- `accent?: string` — brand color (default `#0a7d54`, a placeholder green — set the real brand value).
- `onClose?`, `onDone?`, `onOpenSettings?` — callbacks.
- (b) also: `flavor?`, `lang?`, `steps?`, `stepText?`, `title?`, `subtitle?`, `labels?` — forwarded to the controller.

## Notes

- **No SVG is copied into these files.** (a) overrides only the **text** via a
  `steps` builder (`({ flavor, defaultSteps }) => …`), so the lib's
  flavor-correct art, step count and navigation are kept automatically. Browser
  flavors get the Slovak brand copy; WebView/PWA keep the lib's own copy + art
  (different count), so those flows aren't silently regressed. Override per
  flavor by branching on `ctx.flavor`, or use the declarative `stepText` map.
- `{@html}` / `innerHTML` on `step.text` and `subtitle` is intentional — the
  lib documents those as **trusted, consumer-supplied** HTML. Never feed them
  user input.

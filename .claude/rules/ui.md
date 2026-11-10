---
paths:
  - "src/app/**"
  - "src/ui/**"
  - "src/client/**"
---

# UI rules

These are the rules every new page and control follows. The code shows what exists; this file says how to build the next thing. To change a theme, palette or font, read `.claude/rules/design-system.md`.

The app exists to be read. Every visual decision serves the story text first.

## Story first

- On a story page the story text is the largest, highest-contrast thing. Status, buttons and links stay quieter than the prose.
- Authors exist for accountability: tracing who wrote something offensive, and crediting a good contribution. They are never part of the reading, so they stay findable and quiet.
  - From `md` up, authors sit in a margin beside their paragraph.
  - Below `md` there is no room for a margin, so authors hide behind a switch that is off by default. Show less where there is less space.
  - Pressing an author's name opens a menu: "Highlight passages" (a checkable item), and "Block <name>" or "Unblock <name>". The checkable item replaces press-to-pin, so `aria-pressed` does not apply to the author button. Hover and keyboard focus still preview the highlight.
- Hover is for wide screens; its phone equivalent is tap. Anything hover reveals, a tap or keyboard focus reveals too.
- Paragraphs sit bare on the page, separated by space alone, so they read as one continuous text.

## Layout

- Build pages from `YStack` and `XStack` and their documented style props.
- Spacing uses the space tokens. Widths use the content-width tokens: `simplePage` 672px, `narrow` 448px, `story` 796px, `passage` 620px. A page needs no other pixel value. The one exception is the obscured stand-in's `blur(4px)`: Tamagui has no blur token.
- Design for a 375px-wide phone first, then widen. `md` (768px) is the only breakpoint a layout changes at.
- Page padding is `5` on a phone. Sections of a page are `8` apart; the parts inside a section are `2` to `4` apart.
- Text lines stay readable: prose is at most `passage` wide, and a short intro or form at most `narrow`.
- The root layout wraps every page in one `ScrollView`. A page's root fills a short screen with `grow={1}`, never `flex={1}`: its zero basis clamps the page to the screen height while the content overflows.
- A notice from the app (not from the page) sits in a bar under the `ScrollView`, in the page flow. It takes its space from the bottom, so the story text and controls never move or hide behind it.
- A simple page (loading, error, not found, a lone form) is one centred column, at most `simplePage` wide, with the wordmark at its top-left.
- A raised surface (a card, a side panel, a bar) is `theme="level2"` with the `background` fill and a `border-color` hairline.
- The story page puts the story first. From `md` a rail sits beside it; below `md` the rail's contents stack above and below the story.
  - The rail holds what is about the story but is not the story: the turn, settings for this user, the invite link, and leaving.
  - Settings for this user sit under the turn banner. Leaving is the last thing in the rail.

## Components

The kit is Tamagui. Its components are used as they come, doing what its docs say they can do and nothing more. Only the theme is ours. Where a stock component looks or behaves differently from what we would draw, the stock component wins.

- Allowed, because the docs describe it:
  - theme tokens and the Tamagui config
  - a component's documented props and state props
  - a prop that the [React Native docs](https://reactnative.dev/docs) or [react-native-web docs](https://necolas.github.io/react-native-web/docs/) list for the component underneath, whether or not the Tamagui page links to them. Two examples:
    - `autoComplete` on `Input` and `TextArea`, which wrap React Native's `TextInput`.
    - `aria-pressed` on `Button`, from react-native-web's [accessibility props](https://necolas.github.io/react-native-web/docs/accessibility/), which every View accepts.
  - a component's parts composed in the structure its docs show, such as `AlertDialog`'s `Trigger`, `Portal`, `Overlay`, `Content`, `Title`, `Description` and `Cancel`.
- Not allowed:
  - a prop that none of those docs list for that component, such as an `aria-label` or `role` override that changes what a component exposes
  - a handler that works around a bug in a stock component, such as restoring focus that a `Dialog` drops when it closes. Our own behaviour built with documented methods, such as `focus()` on a `TextInput`, is allowed.
  - a wrapper that adds behaviour, a patched package, or a hand-built replacement for a component Tamagui has
- A bug in a stock component is filed as a GitHub issue, not fixed in our code. A test that has to avoid the bug links the issue.
- Custom UI code is limited to the story text layout: paragraphs, the authors' margin, and the obscured stand-in for a blocked author's passage.
- One exception: the sign-in page (`src/ui/SignIn.tsx`) hosts Clerk's own `<SignIn/>` component and passes it `appearance` colour values taken from our theme roles, and our font. Clerk draws its form with its own CSS, so it takes values, not theme keys. Nothing else on the page, and no other page, uses Clerk's components.
- One exception: the obscured stand-in (`src/ui/ObscuredPassage.tsx`) is a `Text` that sets `role`, `aria-label`, `tabIndex` and `onKeyDown`. A `Button` is a block and would break the paragraph's line. No other `Text` sets them.
- Each page has one level-1 heading, the wordmark, and a level-2 heading for its own title where it has one.
- Keep the root layout's import of `@tamagui/core/reset.css` before `tamagui.generated.css`. Without it the browser's default 2px outset border shows on the `Switch`'s `<button>` and the thumb sits over it. Its one known side effect: a `TextArea` loses its resize grip.

### Colour

- Page code names theme keys that say a role: `background`, `color`, `border-color`, `muted`, `highlight`, `primary`, `error`.
- It names themes by role too: `level2`, `brand`, `destructive`, `scrim`.
- It never names a palette token such as `brand-600`, or a ramp key such as `color-4`.

### Choosing a control

- A link changes the route (the URL). A button does not: it submits, toggles or acts.
  - A button may move the route once its action finishes, such as a form that creates a story and then opens it. It is still a button.
  - A link is a stock `Anchor` inside an Expo Router `Link` with `asChild`. A `Button` never takes an `href`.
- A `Switch` is a setting that takes effect the moment it changes.
- A `Checkbox` is an option sent with a form.
- A stock Tamagui `Menu` lists actions on one item. A visible trigger opens it by press, such as an author's name.
  - Never `ContextMenu`: it hides its actions behind right-click or long-press, which reviewers and most people never try, and long-press is how a phone selects text.
  - A menu item that applies at once needs no confirm dialog when one tap undoes it, such as Block and Unblock.
- An `AlertDialog` confirms an action that can't be undone in one tap. Its overlay is `theme="scrim"`. Its `Content` takes only layout props, with `mx="5"` so it never runs flush to a phone's edges.
  - The confirming button is a plain `Button`, not `AlertDialog.Action`, when a failure must keep the dialog open: `Action` always closes it.

### Buttons

A plain `Button` takes the stock raised fill. Every button states its rank, and every button is `size="xl"`.

- Primary: `theme="brand"`, a solid fill. A screen has at most one, for its main action.
- Secondary: `variant="outlined"`. This is the default for any action that is not the main one.
- Quietest: `variant="quiet"`, no border, for an action the user rarely wants, such as leaving.
- Destructive confirm: `theme="destructive"`, a solid red fill, only inside a confirm dialog.

### Switches

Every switch is built the same way:

- an `XStack items="center" gap="3"`
- holding a `Label` with `htmlFor`, then a stock `Switch` at `size="xl"` with `Switch.Thumb`
- the `Label` text says what turning it on does, as a statement: "Show authors", not "Authors?"

### States

- **Working:** while a request is in flight, its control is disabled. A button's text changes to the action in progress, ending in "…", such as "Leaving…".
- **Failed:** a failed action shows an `error` `Paragraph` with `role="alert"`, next to the control that failed. It has `minH="6"`, so the space is held before any error shows and nothing jumps.
- **Unavailable:** when this browser can't offer a feature at all, its control is absent.
- **Needs a step first:** when the user can make it available, a `muted` line says how in place of the control, such as installing the app.
- **Blocked:** when the user has turned it off outside the app, such as in browser settings, the control is disabled and a `muted` line says why.
- **Obscured:** content the user chose not to see, such as a passage by a blocked author.
  - It shows a blurred stand-in the same length as the text. The page holds no real text until the user presses it.
  - Screen readers get a label, never the text: "Passage by <name>, hidden because you blocked them", or "Opening passage, hidden because you blocked its author" where it cannot be pressed.
  - Blur means obscured and nothing else. Never use it for loading.
- **Loading a value:** one value still arriving beside a label that is known. Show "…" or "Loading…" in `muted` with `role="status"`. No screen uses it yet.
  - A `Spinner` is for a whole screen, dialog, card or block, not one value. No skeleton bars.
  - Obscured is blurred and carries words that say why. Loading a value is short `muted` text and is never blurred.
- **Loading or changing:** text that announces a change without an error uses `role="status"`.

## Touch

- Touch targets follow WCAG 2.2 AA [Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (2.5.8). A target meets it in one of two ways:
  - It is at least 24×24px.
  - Or it has enough spacing: a 24px-diameter circle centred on it overlaps no other target and no other target's circle.
- A link inside a sentence of text is exempt.
- Size comes from Tamagui's documented `size` prop and the size tokens, never from a pixel value on one element.
- Measured: `Switch` and `Checkbox` at `size="xl"` are 28px tall, `Button` at `size="xl"` is 50px, and `Anchor` links are 20px. A link therefore needs the spacing exception.
- A stock component that meets neither the size nor the spacing is left as it is and filed as an issue.
- Everything a user needs is visible, or reachable by tap and keyboard.
- Every interactive element shows a focus ring. Tamagui draws it; check it in both themes.

## Accessibility contract

Tests find elements by role, accessible name, label and visible text, so those are a contract. Styling changes freely; these change only on purpose, with the tests updated in the same commit:

- labels and visible strings
- roles, which are whatever the stock component exposes: a test never forces a role onto a component, except the obscured stand-in below
- `aria-label`s on regions, and `role="status"` and `role="alert"`
- `aria-pressed` on a button that toggles
- the obscured stand-in's role and name: a `button` named "Passage by <name>, hidden because you blocked them" that reveals on Enter or Space, or an `img` named "Opening passage, hidden because you blocked its author" where it cannot be pressed

Every region a test needs to find has an `aria-label` or a heading. Every control has an accessible name from its visible text or its `Label`.

Inside Tamagui's `Dialog` and `AlertDialog`, a close part names itself "Dialog Close" ([#26](https://github.com/ebh/andthen/issues/26)). Tests find it by its visible text scoped to the dialog. A plain `Button` inside the dialog keeps its own name, so tests find it by role.

## Done

A UI change is done when:

- you have looked at every changed page in `light` and `dark` (set `prefers-color-scheme`), at 375px and at desktop width
- every component use fits the "Components" section
- every control that changes the route is a link, and every other control is a button
- the checks in `CLAUDE.md` pass, and so does `pnpm e2e`

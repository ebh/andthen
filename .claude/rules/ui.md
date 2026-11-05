---
paths:
  - "src/app/**"
  - "src/ui/**"
  - "src/client/**"
---

# UI rules

This file is for using the design system. To change a theme, palette or font, read `.claude/rules/design-system.md`.

Page code names theme keys that say a role (`background`, `color`, `border-color`, `muted`, `highlight`, `primary`, `error`) and theme names (`level2`, `brand`, `destructive`, `scrim`). It never names a palette token such as `brand-600`, and never a ramp key such as `color-4`.

The app exists to be read. Every visual decision serves the story text first.

## Story first

- On a story page the story text is the largest, highest-contrast thing. Status, buttons and the invite link stay quieter than the prose.
- Authors exist for accountability: tracing who wrote something offensive, and crediting a good contribution. They are never part of the reading, so they stay findable and quiet.
  - On wide screens (`md` and up) each paragraph's authors sit in a margin beside it, under a hairline rule, one name per author. Hovering a name, or focusing it by keyboard, highlights that author's turns in the paragraph.
  - On narrow screens there is no room for a margin, so authors are hidden behind a "Show authors" control, a stock `Switch` that is off by default. Show less where there is less space. With it on, tapping a name highlights that author's turns until the next tap.
  - Laptops and phones differ. Hover is for the wide-screen view; the phone view's equivalent is tap.
- Paragraphs sit bare on the page, separated by space alone, so they read as one continuous text. A turn continues the previous paragraph unless its author ticked "New paragraph".

## Layout

Pages are built from `YStack` and `XStack` and their documented style props. Spacing uses the space tokens; widths use the content-width tokens in the config (`simplePage` 672px, `narrow` 448px, `story` 796px, `passage` 620px). A page needs no other pixel value.

- The root layout wraps every page in one `ScrollView`, so a page taller than the screen scrolls. A page's root fills a short screen with `grow={1}`, never `flex={1}`: its zero basis clamps the page to the screen height while the content overflows.
- The root layout puts the update notice in a bar under the `ScrollView`, in the page flow and not over it. It takes the space it needs from the bottom, so the story text and the controls never move or hide. The bar is `theme="level2"` with the `background` fill and a `border-color` hairline above it, padding `5` at the sides and `3` above and below, with `muted` text.
- Design for a 375px-wide phone first, then widen. `md` is Tamagui's built-in 768px breakpoint, and it is the only breakpoint a layout changes at.
- Page padding is `5` on a phone. Sections of a page are `8` apart; the parts inside a section are `2` to `4` apart.
- A simple page (loading, error, not found, join form) is one column, centred on the screen, at most `simplePage` wide. The wordmark sits at the top-left of the column, `8` above the content.
- The join form is a card: `theme="level2"` with the `background` fill, a `border-color` hairline border, padding `6`.
- The landing page is two columns from `md`: the pitch on the left, slightly wider (flex 1.1 to 1), and the form on a `theme="level2"` panel on the right.
  - The pitch column has padding `16` at the sides and `12` above. The wordmark sits at its top, and the headline `28` below it.
  - The headline is `4xl` on a phone and `6xl` from `md`. The intro line under it is at most `narrow` wide.
  - From `md` the three steps sit under the intro as a list with hairline rules. A phone drops them.
  - When the writer has stories, their list replaces the pitch and the form heading reads "Start a new story". The list's "Your stories" heading is `3xl`, the same as the form heading. A row is a link without an underline. While the list loads, the column shows neither, and the form is there at once.
  - If the list fails to load, the column shows an alert "Couldn't load your stories." with a "Retry" button, and the form stays.
  - After the writer leaves a story, the column shows a quiet "You left the story." status, once. A reload or a later visit shows nothing.
  - The form is centred in its panel, at most `narrow` wide, with padding `16`. On a phone the panel follows the pitch, padded `5` at the sides and `10` above and below.
- The story page is a rail beside the story from `md`.
  - The rail is `80` wide with a `border-color` hairline on its right and padding `8`. The wordmark and the link to the writer's stories sit at its top, the turn banner `14` below them, and the invite link at its bottom, with the quiet "Leave story" button under it. "Leave story" is a `quiet` `Button`, the quietest action on the page, and it is the trigger of the leave dialog.
  - The story column has padding `16` at the sides and `14` above. Its content is left-aligned and at most `story` wide.
  - A paragraph is at most `passage` wide. Its authors' margin sits beside it and is at most `36` wide.
  - The composer's counter sits at the left of one row, with "Suggest continuations" and "Add to the story" at the right.
  - "Add to the story" is the page's one primary button; "Suggest continuations" is secondary, an `outlined` `Button`.
- On a phone the story page is three blocks, each padded `5`: the rail with a `border-color` hairline under it, the story, and the invite link with the "Leave story" button under it. The composer's buttons are full width and stacked.
- The turn headline is `xl` on a phone and `3xl` from `md`. The turn order is a wrapping row on a phone and a column from `md`. The current writer's name sits on a `highlight` pill.
- Authors shown on a phone sit in one wrapping row above their paragraph, with no left padding.
- The invite field is an `Input` at `size="md"`, so a full invite URL fits in the rail.

## Components

The kit is Tamagui. Its components are used as they come, doing what its docs say they can do and nothing more. Only the theme is ours. Where a stock component looks or behaves differently from what we would draw, the stock component wins.

- Allowed, because the docs describe it:
  - theme tokens and the Tamagui config
  - a component's documented props and state props
  - a prop that the [React Native docs](https://reactnative.dev/docs) or [react-native-web docs](https://necolas.github.io/react-native-web/docs/) list for the component underneath, whether or not the Tamagui page links to them. Two examples:
    - `autoComplete` on `Input` and `TextArea`, which wrap React Native's `TextInput`.
    - `aria-pressed` on `Button`, from react-native-web's [accessibility props](https://necolas.github.io/react-native-web/docs/accessibility/), which every View accepts.
  - a component's parts composed in the documented structure, such as the leave dialog: the `AlertDialog` skin that `tamagui` exports, as its docs show it (`Trigger`, `Portal`, `Overlay`, `Content`, `Title`, `Description`, `Cancel`). `Overlay` takes only `theme="scrim"`, the `light_scrim` and `dark_scrim` themes in the config, whose `background` is the translucent colour that dims the page behind the dialog. `Content` takes only layout props (`gap`, `maxW`, and `mx="5"`, the phone page gutter, so it never runs flush to the screen edges).
- Not allowed:
  - a prop that none of those docs (Tamagui, React Native, react-native-web) list for that component, such as an `aria-label` or `role` override that changes what a component exposes
  - a handler that works around a bug in a stock component, such as restoring focus that a `Dialog` drops when it closes. Our own behaviour built with documented methods, such as `focus()` on a `TextInput`, is allowed.
  - a wrapper that adds behaviour, a patched package, or a hand-built replacement for a component Tamagui has
- A bug in a stock component is filed as a GitHub issue. It is not fixed in our code. A test that has to avoid the bug links the issue.
- Custom UI code is limited to the story text layout: paragraphs, and the authors in a margin from `md` up.
- Each page has one level-1 heading, the wordmark, and a level-2 heading for its own title where it has one.

### Buttons

A plain `Button` takes the stock raised fill, from the `level2` theme every `Button` wraps itself in. Every button states its rank.

- Secondary: `variant="outlined"`. This is the default for any action that is not the page's main one.
- Quietest: `variant="quiet"`, no border, such as the story rail's "Leave story".
- Primary: `theme="brand"`, a solid fill. A screen has at most one.
- Destructive confirm: `theme="destructive"`, a solid red fill, such as the leave dialog's "Leave story".

## Touch

- Touch targets follow WCAG 2.2 AA [Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (2.5.8). A target meets it in one of two ways:
  - It is at least 24×24px.
  - Or it has enough spacing: a 24px-diameter circle centred on it overlaps no other target and no other target's circle.
- A link inside a sentence of text is exempt.
- Size comes from Tamagui's documented `size` prop and the size tokens in the config, never from a pixel value on one element.
- A stock component that meets neither the size nor the spacing is left as it is and filed as an issue.
- Measured today: stock `Switch` and `Checkbox` at `size="xl"` are 28px tall. `Button` at `size="xl"` is 50px. `Anchor` links are 20px tall, so they pass only through the spacing exception.
- Everything a user needs is visible, or reachable by tap and keyboard.
- Every interactive element shows a focus ring. Tamagui draws it; check it in both themes.

## Accessibility contract

Tests find elements by role, accessible name, label and visible text. The role is whatever the stock component exposes: a test never forces a role onto a component. Styling changes freely. These change only on purpose, with the tests updated in the same commit:

- labels and visible strings
- `aria-label`s on sections
- `role="status"` and `role="alert"`, including the single `status` in `TurnBanner`
- the list, item, button structure in `Suggestions`
- the "Show authors" `Switch` (role `switch`) and the author buttons (`aria-pressed`) in `StoryText`
- the "New paragraph" checkbox in `Composer`
- the "Your stories" region on the landing page, headed "Your stories", whose rows are links named by the opening passage and the turn status
- the "Couldn't load your stories." alert with its "Retry" button, and the "You left the story." status, on the landing page
- the "Your stories" link in the story rail
- the "Leave story" button, and the leave dialog: role `alertdialog`, named "Leave this story?", with an `alert` for failures and two buttons. "Cancel" is an `AlertDialog.Cancel` and "Leave story" is a plain `Button`, not `AlertDialog.Action`, because `Action` closes the dialog and a failed leave keeps it open. The "Leave story" button reads "Leaving…" and is disabled while the request is in flight.
- the update notice in `UpdateReady`: an always-present `status` region under the page, which holds the text "A new version is ready." and an outlined "Update" button once a new build is waiting. It is absent on the update screen.
- the "You left this story" screen: its opening quote, a "Rejoin as …" button that reads "Rejoining…" while it sends, an alert for failures, and a "← Your stories" link

Links and buttons:

- Use a link when the action changes the route (the URL). Use a button when it does not, such as submitting a form, leaving a story or toggling something.
- A link is a stock `Anchor` inside an Expo Router `Link` with `asChild`, as in `Wordmark.tsx`. A `Button` is never given an `href`.
- A button may move the route when it finishes an action. "Start the story" creates a story and then moves to `/<id>`. It is still a button, because it submits a form.
- A link under 24px tall, such as `Anchor` at 20px, needs the spacing exception from the touch rule above. A link with neither the size nor the spacing is left as it is and an issue is filed.

Inside Tamagui's `Dialog` and `AlertDialog`, tests find a close button, such as the leave dialog's "Cancel", by its visible text scoped to the dialog, because `Dialog.Close` names itself "Dialog Close" ([#26](https://github.com/ebh/andthen/issues/26)). A plain `Button` inside the dialog keeps its own name, so tests find it by role. Tests find the dialog itself by its role, `alertdialog`.

## Done

A UI change is done when:

- you have looked at every changed page in `light` and `dark` (set `prefers-color-scheme`), at 375px and at desktop width
- every component use fits the "Components" section
- every control that changes the route is a link, and every other control is a button
- the checks in `CLAUDE.md` pass, and so does `pnpm e2e`

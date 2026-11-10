import type { FocusEvent } from "react";
import { Button, Menu, Text } from "tamagui";

import type { BlockOffer } from "../client/storyRules";

interface AuthorMenuProps {
  name: string;
  offer: BlockOffer;
  /** True while any Block or Unblock is out or its list is reloading. */
  busy: boolean;
  /** Called when the user picks the Block or Unblock item. */
  onBlockChange: () => void;
  highlighted: boolean;
  pinned: boolean;
  /** Whether the device has a pointer that hovers; touch devices fire emulated hovers on tap. */
  hoverable: boolean;
  onPreview: (on: boolean) => void;
  onTogglePin: () => void;
}

type MenuItemProps =
  | { children: string; checked: boolean; onCheckedChange: () => void }
  | { children: string; disabled: boolean; onSelect: () => void };

/** An author's name; pressing it opens a menu to pin their highlight and to block or unblock them. */
export function AuthorMenu({
  name,
  offer,
  busy,
  onBlockChange,
  highlighted,
  pinned,
  hoverable,
  onPreview,
  onTogglePin,
}: AuthorMenuProps) {
  const preview = (on: boolean) =>
    hoverable
      ? () => {
          onPreview(on);
        }
      : undefined;

  return (
    <Menu>
      <Menu.Trigger asChild>
        <Button
          size="xl"
          px="0"
          variant="quiet"
          onMouseEnter={preview(true)}
          onMouseLeave={preview(false)}
          onFocus={(event) => {
            // A press also focuses the button; only keyboard focus previews, or the menu would
            // open with the highlight already on and its first toggle would switch it off.
            if (isKeyboardFocus(event)) {
              onPreview(true);
            }
          }}
          onBlur={() => {
            onPreview(false);
          }}
        >
          <Button.Text textDecorationLine={highlighted ? "underline" : "none"}>{name}</Button.Text>
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          theme="level2"
          bg="background"
          borderWidth={1}
          borderColor="border-color"
          rounded="lg"
          p="2"
        >
          <MenuItem checked={pinned} onCheckedChange={onTogglePin}>
            Highlight passages
          </MenuItem>
          {offer.type !== "none" && (
            <MenuItem disabled={busy} onSelect={onBlockChange}>
              {offer.label}
            </MenuItem>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

function isKeyboardFocus(event: FocusEvent): boolean {
  return (
    event.currentTarget instanceof HTMLElement && event.currentTarget.matches(":focus-visible")
  );
}

function MenuItem(props: MenuItemProps) {
  const style = {
    flexDirection: "row",
    items: "center",
    gap: "2",
    px: "3",
    py: "2",
    rounded: "md",
    cursor: "pointer",
    bg: "hover:highlight focus:highlight",
  } as const;

  if ("checked" in props) {
    return (
      <Menu.CheckboxItem {...style} checked={props.checked} onCheckedChange={props.onCheckedChange}>
        <Menu.ItemIndicator>
          <Text aria-hidden>✓</Text>
        </Menu.ItemIndicator>
        <Menu.ItemTitle>{props.children}</Menu.ItemTitle>
      </Menu.CheckboxItem>
    );
  }

  return (
    <Menu.Item {...style} disabled={props.disabled} onSelect={props.onSelect}>
      <Menu.ItemTitle>{props.children}</Menu.ItemTitle>
    </Menu.Item>
  );
}

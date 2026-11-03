import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no modal dialogs. A stand-in keeps `open` in step with showModal and close, and
// queues the `close` event after closing an open dialog, as browsers do.
function showModal(this: HTMLDialogElement): void {
  this.setAttribute("open", "");
}

function close(this: HTMLDialogElement): void {
  if (!this.hasAttribute("open")) {
    return;
  }
  this.removeAttribute("open");
  setTimeout(() => {
    this.dispatchEvent(new Event("close"));
  }, 0);
}

if (
  typeof HTMLDialogElement !== "undefined" &&
  typeof HTMLDialogElement.prototype.showModal !== "function"
) {
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
}

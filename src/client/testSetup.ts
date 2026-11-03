import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no modal dialogs. A stand-in keeps `open` in step with showModal and close.
function showModal(this: HTMLDialogElement): void {
  this.setAttribute("open", "");
}

function close(this: HTMLDialogElement): void {
  this.removeAttribute("open");
}

if (
  typeof HTMLDialogElement !== "undefined" &&
  typeof HTMLDialogElement.prototype.showModal !== "function"
) {
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
}

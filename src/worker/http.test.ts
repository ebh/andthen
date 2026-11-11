import { describe, expect, it } from "vitest";

import { isJsonOrBodylessDelete, isTrustedOrigin } from "./http";

describe("isJsonOrBodylessDelete", () => {
  const noHeaders = {
    contentType: undefined,
    contentLength: undefined,
    transferEncoding: undefined,
  };

  it.each([
    ["JSON", { method: "POST", contentType: "application/json" }, true],
    [
      "JSON with a charset",
      { method: "POST", contentType: "application/json; charset=utf-8" },
      true,
    ],
    [
      "JSON with a space before the parameter",
      { method: "PUT", contentType: "application/json ;x=1" },
      true,
    ],
    ["JSON in another casing", { method: "POST", contentType: "Application/JSON" }, true],
    [
      "a type that only starts with json",
      { method: "POST", contentType: "application/jsonx" },
      false,
    ],
    [
      "a type that only ends with json",
      { method: "POST", contentType: "text/application/json" },
      false,
    ],
    ["plain text", { method: "POST", contentType: "text/plain" }, false],
    ["no content type and no body", { method: "POST" }, false],
    ["no content type and a body", { method: "POST", contentLength: "12" }, false],
    ["a PATCH with JSON", { method: "PATCH", contentType: "application/json" }, true],
    ["a PATCH with plain text", { method: "PATCH", contentType: "text/plain" }, false],
    ["a DELETE with no headers", { method: "DELETE" }, true],
    ["a DELETE with a zero length", { method: "DELETE", contentLength: "0" }, true],
    ["a DELETE with a length", { method: "DELETE", contentLength: "2" }, false],
    ["a DELETE with a chunked body", { method: "DELETE", transferEncoding: "chunked" }, false],
    [
      "a DELETE with a JSON content type and no body",
      { method: "DELETE", contentType: "application/json" },
      true,
    ],
    [
      "a DELETE with JSON and a body",
      { method: "DELETE", contentType: "application/json", contentLength: "2" },
      false,
    ],
  ])("for %s", (_name, request, expected) => {
    expect(isJsonOrBodylessDelete({ ...noHeaders, ...request })).toBe(expected);
  });
});

describe("isTrustedOrigin", () => {
  const ownOrigin = "https://andthen.page";

  it.each([
    ["the request's own origin, with no credential", ownOrigin, false, true],
    ["the request's own origin, with a credential", ownOrigin, true, true],
    ["another origin, with no credential", "https://evil.example", false, false],
    ["another origin, with a credential", "https://evil.example", true, false],
    ["the origin 'null', with a credential", "null", true, false],
    ["an empty origin, with a credential", "", true, false],
    ["no origin, with a credential", undefined, true, true],
    ["no origin, with no credential", undefined, false, false],
  ])("for %s", (_name, origin, carriesCredential, expected) => {
    expect(isTrustedOrigin({ origin, ownOrigin, carriesCredential })).toBe(expected);
  });
});

// test/copyButton.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CopyButton, { copyLabel } from "../src/components/CopyButton.jsx";

describe("copyLabel", () => {
  it("shows the caller's label when idle, with no state class", () => {
    expect(copyLabel("idle", "Copy snippet")).toEqual({ label: "Copy snippet", className: undefined });
  });
  it("confirms a copy", () => {
    expect(copyLabel("copied", "Copy snippet")).toEqual({ label: "✓ Copied", className: "copied" });
  });
  it("reports a failure rather than silently reverting", () => {
    expect(copyLabel("failed", "Copy snippet")).toEqual({ label: "Copy failed", className: "copy-failed" });
  });
});

describe("CopyButton SSR", () => {
  it("renders the idle label", () => {
    const html = renderToStaticMarkup(<CopyButton text="x">Copy snippet</CopyButton>);
    expect(html).toContain("Copy snippet");
    expect(html).not.toContain("disabled");
  });
  it("honours disabled", () => {
    const html = renderToStaticMarkup(<CopyButton text="x" disabled>Copy snippet</CopyButton>);
    expect(html).toContain("disabled");
  });
});

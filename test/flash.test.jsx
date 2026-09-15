// test/flash.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Flash from "../src/components/Flash.jsx";

describe("Flash SSR", () => {
  it("renders the message as a success banner", () => {
    const html = renderToStaticMarkup(<Flash message="Imported 6 match(es)." onDone={() => {}} />);
    expect(html).toContain("Imported 6 match(es).");
    expect(html).toContain("banner ok");
    expect(html).toContain("flash"); // carries the fade animation
    // it self-dismisses in 5s, so a screen reader has to be told it appeared
    expect(html).toContain('role="status"');
  });
  it("renders nothing when there is no message", () => {
    expect(renderToStaticMarkup(<Flash message={null} onDone={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<Flash message="" onDone={() => {}} />)).toBe("");
  });
});

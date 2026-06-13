// test/consoleImport.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData } from "../src/lib/store.js";
import ConsoleImport from "../src/components/ConsoleImport.jsx";

describe("ConsoleImport SSR", () => {
  it("renders the panel with the snippet and token field", () => {
    const data = { ...emptyData(), meta: { ...emptyData().meta, sofascoreToken: "2421c3" } };
    const html = renderToStaticMarkup(<ConsoleImport data={data} update={() => {}} />);
    expect(html).toContain("Import via console");
    expect(html).toContain("https://www.sofascore.com/api/v1");
    expect(html).toContain("2421c3");
  });
});

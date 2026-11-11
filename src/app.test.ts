// Copyright (C) 2026 PK Digital
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

let HAS_GS = false;
try {
  execFileSync("gs", ["--version"], { stdio: "ignore" });
  HAS_GS = true;
} catch {
  // tests skip without Ghostscript (CI and the Docker image install it)
}

const EPS = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 200 100
%%EndComments
1 0 0 setrgbcolor
10 10 180 80 rectfill
0 setgray
/Helvetica findfont 18 scalefont setfont
20 45 moveto (Canvium EPS) show
showpage
%%EOF
`;

const TWO_PAGE_PS = `%!PS-Adobe-3.0
%%Pages: 2
%%Page: 1 1
/Helvetica findfont 36 scalefont setfont 72 700 moveto (Page one) show showpage
%%Page: 2 2
/Helvetica findfont 36 scalefont setfont 72 700 moveto (Page two) show showpage
%%EOF
`;

async function convert(body: string | Uint8Array) {
  return app.request("/convert", { method: "POST", body: typeof body === "string" ? body : new Uint8Array(body) });
}

describe.skipIf(!HAS_GS)("ps worker", () => {
  it("reports its Ghostscript version and source", async () => {
    const res = await app.request("/health");
    expect(await res.json()).toMatchObject({ ok: true, ghostscript: expect.stringMatching(/^\d+\.\d+/), source: expect.stringContaining("github.com") });
  });

  it("converts EPS to a PDF cropped to its bounding box", async () => {
    const res = await convert(EPS);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const pdf = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toMatch(/\/MediaBox\s*\[\s*0 0 200 100\s*\]/);
  }, 30_000);

  it("keeps every page of multi-page PostScript", async () => {
    const pdf = Buffer.from(await (await convert(TWO_PAGE_PS)).arrayBuffer()).toString("latin1");
    expect(pdf.match(/\/Type\s*\/Page\b/g)?.length).toBe(2);
  }, 30_000);

  it("refuses to read files from the container (SAFER)", async () => {
    const res = await convert("%!PS\n(/etc/passwd) (r) file 100 string readstring pop print\nshowpage\n");
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toMatch(/root:/);
  }, 30_000);

  it("explains input it can't convert", async () => {
    const res = await convert("this is not postscript at all");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/could not be converted|no pages/) });
  }, 30_000);

  it("rejects an empty body", async () => {
    expect((await convert("")).status).toBe(400);
  });
});

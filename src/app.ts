// Copyright (C) 2026 PK Digital
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ConvertError, ghostscriptVersion, postscriptToPdf } from "./convert.ts";
import { mupdfVersion, renderPdfPage, renderPdfPages } from "./pdf.ts";

const MAX_BYTES = Number(process.env.MAX_BYTES ?? 200 * 1024 * 1024);
const SOURCE = "https://github.com/pkdigital/canvium-ps-worker";

export const app = new Hono();

/** Health, plus where the source is (AGPL section 13) and which Ghostscript and MuPDF are inside. */
app.get("/health", async (c) => c.json({ ok: true, ghostscript: await ghostscriptVersion(), mupdf: await mupdfVersion(), source: SOURCE }));

app.use("*", bodyLimit({ maxSize: MAX_BYTES, onError: (c) => c.json({ error: "file too large" }, 413) }));

/** POST PostScript or EPS bytes; returns application/pdf. 422 when the file can't be converted. */
app.post("/convert", async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "empty body" }, 400);
  try {
    const pdf = await postscriptToPdf(bytes);
    return c.body(new Uint8Array(pdf), 200, { "content-type": "application/pdf", "x-source": SOURCE });
  } catch (err) {
    if (err instanceof ConvertError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

/**
 * POST PDF bytes; returns one page as PNG. Query: page (default 1), size (longest side in pixels,
 * default 2048, 16-4096). Headers: x-pages, x-page-width-pt, x-page-height-pt. 422 when the PDF
 * can't be rendered (damaged, password protected, no such page).
 */
app.post("/pdf/render", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const size = Number(c.req.query("size") ?? 2048);
  if (!Number.isInteger(page) || page < 1) return c.json({ error: "page must be a positive integer" }, 400);
  if (!Number.isInteger(size) || size < 16 || size > 4096) return c.json({ error: "size must be 16-4096" }, 400);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "empty body" }, 400);
  try {
    const out = await renderPdfPage(bytes, page, size);
    return c.body(new Uint8Array(out.png), 200, {
      "content-type": "image/png",
      "x-pages": String(out.pages),
      "x-page-width-pt": String(out.widthPt),
      "x-page-height-pt": String(out.heightPt),
      "x-source": SOURCE,
    });
  } catch (err) {
    if (err instanceof ConvertError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

/**
 * POST PDF bytes; returns JSON { png (base64), text, pages, widthPt, heightPt } for one page:
 * the image and the page's text layer in one call. Query as /pdf/render. 422 as /pdf/render.
 */
app.post("/pdf/preview", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const size = Number(c.req.query("size") ?? 2048);
  if (!Number.isInteger(page) || page < 1) return c.json({ error: "page must be a positive integer" }, 400);
  if (!Number.isInteger(size) || size < 16 || size > 4096) return c.json({ error: "size must be 16-4096" }, 400);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "empty body" }, 400);
  try {
    const out = await renderPdfPage(bytes, page, size, true);
    return c.json({ png: out.png.toString("base64"), text: out.text ?? "", pages: out.pages, widthPt: out.widthPt, heightPt: out.heightPt }, 200, { "x-source": SOURCE });
  } catch (err) {
    if (err instanceof ConvertError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

/** Most pages one /pdf/pages call draws. */
const MAX_PAGES = 500;

/**
 * POST PDF bytes; draws several pages in one pass and streams them back as they are finished,
 * as NDJSON: one line per page, `{ page, png (base64) }` or `{ page, error }` for a page that
 * couldn't be drawn, then `{ done: true, pages }` (the document's page count). Query: pages (a
 * comma-separated list, e.g. 2,3,5; pages past the end are left out), size (as /pdf/render).
 * 422 JSON `{ error }` when the PDF can't be opened. A response without the done line was cut
 * short (treat the missing pages as failed).
 */
app.post("/pdf/pages", async (c) => {
  const pages = (c.req.query("pages") ?? "").split(",").map(Number);
  const size = Number(c.req.query("size") ?? 2048);
  if (!pages.length || pages.length > MAX_PAGES || !pages.every((p) => Number.isInteger(p) && p >= 1)) {
    return c.json({ error: `pages must be a comma-separated list of 1 to ${MAX_PAGES} page numbers` }, 400);
  }
  if (!Number.isInteger(size) || size < 16 || size > 4096) return c.json({ error: "size must be 16-4096" }, 400);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "empty body" }, 400);
  let drawn: Awaited<ReturnType<typeof renderPdfPages>>;
  try {
    drawn = await renderPdfPages(bytes, pages, size);
  } catch (err) {
    if (err instanceof ConvertError) return c.json({ error: err.message }, 422);
    throw err;
  }
  const { total, images } = drawn;
  const line = (o: unknown) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);
  // Pulled one page at a time, so mutool's output waits on a slow reader rather than piling up here.
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const next = await images.next();
      if (next.done) {
        ctrl.enqueue(line({ done: true, pages: total }));
        ctrl.close();
      } else if ("png" in next.value) ctrl.enqueue(line({ page: next.value.page, png: next.value.png.toString("base64") }));
      else ctrl.enqueue(line(next.value));
    },
    async cancel() {
      await images.return(undefined);
    },
  });
  return c.body(body, 200, { "content-type": "application/x-ndjson", "x-pages": String(total), "x-source": SOURCE });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "conversion failed", detail: err.message }, 500);
});

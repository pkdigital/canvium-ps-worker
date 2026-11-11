// Copyright (C) 2026 PK Digital
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ConvertError, ghostscriptVersion, postscriptToPdf } from "./convert.ts";

const MAX_BYTES = Number(process.env.MAX_BYTES ?? 200 * 1024 * 1024);
const SOURCE = "https://github.com/pkdigital/canvium-ps-worker";

export const app = new Hono();

/** Health, plus where the source is (AGPL section 13) and which Ghostscript is inside. */
app.get("/health", async (c) => c.json({ ok: true, ghostscript: await ghostscriptVersion(), source: SOURCE }));

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

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "conversion failed", detail: err.message }, 500);
});

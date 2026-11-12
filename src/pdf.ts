// Copyright (C) 2026 PK Digital
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ConvertError } from "./convert.ts";

const run = promisify(execFile);

const TIMEOUT_MS = Number(process.env.MUTOOL_TIMEOUT_MS ?? 60_000);
/** Longest page text returned; a page of dense text is a few thousand characters. */
const MAX_TEXT_CHARS = 20_000;

export interface PdfPage {
  /** PNG of the page, white background, longest side `longSide` pixels at most. */
  png: Buffer;
  /** The page's text layer (empty for scanned pages), when asked for. At most MAX_TEXT_CHARS. */
  text?: string;
  /** Number of pages in the document. */
  pages: number;
  /** Size of the rendered page in points (1/72 inch), after its /Rotate. */
  widthPt: number;
  heightPt: number;
}

function fail(err: unknown, what: string): never {
  const e = err as { killed?: boolean; stderr?: string; stdout?: string; message?: string };
  if (e.killed) throw new ConvertError(`${what} took longer than ${TIMEOUT_MS / 1000}s`);
  const text = (e.stderr || e.stdout || e.message || "").trim();
  if (/password|authenticate/i.test(text)) throw new ConvertError("PDF is password protected");
  const detail = text.split("\n").find((l) => l.trim()) ?? "unknown error";
  throw new ConvertError(`PDF could not be rendered: ${detail.slice(0, 200)}`);
}

/**
 * Render one page of a PDF to PNG with MuPDF's `mutool draw`.
 *
 * MuPDF runs as a separate, unmodified program (Debian's mupdf-tools package); nothing links
 * against libmupdf. It decodes large embedded images at the size it needs, so a page holding a
 * 50-megapixel photo renders in well under a second where other renderers take 10 s or more.
 * The container has no network access; mutool reads only the file it is given.
 */
export async function renderPdfPage(bytes: Uint8Array, page = 1, longSide = 2048, withText = false): Promise<PdfPage> {
  const dir = await mkdtemp(join(tmpdir(), "pdf-"));
  try {
    const input = join(dir, "in.pdf");
    const output = join(dir, "out.png");
    await writeFile(input, bytes);
    const opts = { timeout: TIMEOUT_MS, killSignal: "SIGKILL" as const, maxBuffer: 4 * 1024 * 1024, cwd: dir };

    // Page count and the page's box. `mutool info` is slow on big files (it walks every
    // object), so read the page tree count and the page's bounds directly.
    let pages: number;
    let widthPt: number;
    let heightPt: number;
    try {
      const count = await run("mutool", ["show", "-b", input, "trailer/Root/Pages/Count"], opts);
      pages = Number.parseInt(count.stdout.trim(), 10);
      const box = await run("mutool", ["pages", input, String(page)], opts);
      // <page pagenum="1"> <MediaBox l="0" b="0" r="612" t="792" /> ... <Rotate v="0" />
      const tag = (name: string) => new RegExp(`<${name} l="([-\\d.]+)" b="([-\\d.]+)" r="([-\\d.]+)" t="([-\\d.]+)"`).exec(box.stdout);
      const b = tag("CropBox") ?? tag("MediaBox");
      if (!b) throw new Error(`no page box for page ${page}`);
      const [l, bt, r, t] = b.slice(1).map(Number) as [number, number, number, number];
      const rotate = Number(/<Rotate v="(-?\d+)"/.exec(box.stdout)?.[1] ?? 0);
      [widthPt, heightPt] = [Math.abs(r - l), Math.abs(t - bt)];
      if (Math.abs(rotate) % 180 === 90) [widthPt, heightPt] = [heightPt, widthPt];
    } catch (err) {
      fail(err, "reading the PDF");
    }
    if (!(pages >= 1)) throw new ConvertError("PDF has no pages");
    if (page > pages) throw new ConvertError(`PDF has ${pages} pages; page ${page} requested`);
    if (!(widthPt > 0 && heightPt > 0)) throw new ConvertError(`PDF page ${page} has no size`);

    const textFile = join(dir, "out.txt");
    try {
      // -w/-h fit the page inside longSide x longSide, keeping its shape. -A 8: full antialiasing.
      // The text layer (if asked) is extracted at the same time, by a second mutool process.
      await Promise.all([
        run("mutool", ["draw", "-q", "-A", "8", "-c", "rgb", "-w", String(longSide), "-h", String(longSide), "-F", "png", "-o", output, input, String(page)], opts),
        withText ? run("mutool", ["draw", "-q", "-F", "txt", "-o", textFile, input, String(page)], opts) : null,
      ]);
    } catch (err) {
      fail(err, "rendering the PDF");
    }
    const png = await readFile(output).catch(() => null);
    if (!png || png.length < 8) throw new ConvertError(`PDF page ${page} produced no image`);
    let text: string | undefined;
    if (withText) {
      const raw = await readFile(textFile, "utf8").catch(() => "");
      // Collapse the layout whitespace mutool keeps, but keep paragraph breaks.
      text = raw.replace(/\f/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS);
    }
    return { png, pages, widthPt, heightPt, text };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** MuPDF version, reported by /health so a deployment can be checked against its source. */
export async function mupdfVersion(): Promise<string | null> {
  try {
    const { stdout, stderr } = await run("mutool", ["-v"], { timeout: 5000 }).catch((e) => e as { stdout: string; stderr: string });
    return /(\d+\.\d+(\.\d+)?)/.exec(`${stdout}${stderr}`)?.[1] ?? null;
  } catch {
    return null;
  }
}

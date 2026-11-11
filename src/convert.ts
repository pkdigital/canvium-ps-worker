// Copyright (C) 2026 PK Digital
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The file could not be converted (not PostScript, damaged, or too slow): a client error, not a crash. */
export class ConvertError extends Error {}

const TIMEOUT_MS = Number(process.env.GS_TIMEOUT_MS ?? 120_000);

/**
 * Convert PostScript or EPS to PDF with Ghostscript's pdfwrite device.
 *
 * Ghostscript runs as a separate, unmodified program (the `gs` binary from the distribution's
 * package); nothing here links against libgs. -dSAFER stops a document reading or writing files
 * or running commands; the container also has no network. -dEPSCrop sizes EPS pages to their
 * bounding box instead of a full sheet of paper.
 */
export async function postscriptToPdf(bytes: Uint8Array): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ps-"));
  try {
    const input = join(dir, "in.ps");
    const output = join(dir, "out.pdf");
    await writeFile(input, bytes);
    try {
      await run(
        "gs",
        [
          "-q",
          "-dSAFER",
          "-dBATCH",
          "-dNOPAUSE",
          "-dNOPROMPT",
          "-sDEVICE=pdfwrite",
          "-dEPSCrop",
          "-dAutoRotatePages=/None",
          `-sOutputFile=${output}`,
          "-f",
          input,
        ],
        { timeout: TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, cwd: dir },
      );
    } catch (err) {
      const e = err as { killed?: boolean; stderr?: string; stdout?: string; message?: string };
      if (e.killed) throw new ConvertError(`conversion took longer than ${TIMEOUT_MS / 1000}s`);
      const detail = (e.stderr || e.stdout || e.message || "").trim().split("\n").find((l) => l.trim()) ?? "unknown error";
      throw new ConvertError(`PostScript could not be converted: ${detail.slice(0, 200)}`);
    }
    const pdf = await readFile(output).catch(() => null);
    if (!pdf || pdf.length < 8 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new ConvertError("PostScript produced no pages");
    }
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Ghostscript version, reported by /health so a deployment can be checked against its source. */
export async function ghostscriptVersion(): Promise<string | null> {
  try {
    return (await run("gs", ["--version"], { timeout: 5000 })).stdout.trim();
  } catch {
    return null;
  }
}

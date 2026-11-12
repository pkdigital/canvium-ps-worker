# canvium-ps-worker

A small HTTP service that converts PostScript (`.ps`) and Encapsulated PostScript (`.eps`) to PDF
by running [Ghostscript](https://ghostscript.com/), and renders PDF pages to PNG by running
[MuPDF](https://mupdf.com/)'s `mutool`.

It is the PostScript converter and PDF renderer for [Canvium](https://canvium.com), which makes
previews and thumbnails from the result. It is published on its own, under the GNU Affero General
Public License v3, because it ships Ghostscript and MuPDF (both AGPL-3.0).

## How it uses Ghostscript and MuPDF

- Ghostscript is the unmodified `ghostscript` package from Debian bookworm, installed in the image.
- It is run as a separate program (`gs`) for each request. Nothing links against `libgs`.
- It runs with `-dSAFER`, so a document can't read or write files or run commands. In production
  the container also has no network access.
- MuPDF is the unmodified `mupdf-tools` package from Debian bookworm, run as a separate program
  (`mutool`) for each request. Nothing links against `libmupdf`.
- Source for both: `apt-get source ghostscript mupdf` on Debian bookworm, or the matching releases
  at <https://ghostscript.com/releases/> and <https://mupdf.com/releases/>. `GET /health` reports
  both versions.

## API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/convert` | PostScript or EPS bytes | `200 application/pdf`; `422` JSON `{ error }` if the file can't be converted; `413` if over the size limit |
| `POST` | `/pdf/render?page=1&size=2048` | PDF bytes | `200 image/png` of the page, longest side `size` px (16-4096), with headers `x-pages`, `x-page-width-pt`, `x-page-height-pt`; `422` JSON `{ error }` if the PDF can't be rendered (damaged, password protected, no such page) |
| `POST` | `/pdf/preview?page=1&size=2048` | PDF bytes | `200` JSON `{ png (base64), text, pages, widthPt, heightPt }`: the page image and its text layer (empty for scanned pages, at most 20,000 characters) in one call; errors as `/pdf/render` |
| `GET` | `/health` | | `{ ok, ghostscript, mupdf, source }` |

EPS pages are cropped to the file's `%%BoundingBox`. Multi-page PostScript keeps every page.

Settings (environment): `PORT` (default 8080), `GS_TIMEOUT_MS` (default 120000),
`MUTOOL_TIMEOUT_MS` (default 60000), `MAX_BYTES` (default 200 MB).

## Run it

```sh
docker build -t canvium-ps-worker .
docker run --rm -p 8080:8080 canvium-ps-worker
curl -X POST --data-binary @drawing.eps localhost:8080/convert -o drawing.pdf
```

Or with Node 22+, Ghostscript and mupdf-tools installed: `npm install && npm run dev`. Tests: `npm test`.

Images are published to `ghcr.io/pkdigital/canvium-ps-worker` from `main` (tag `main`) and from
version tags (`v0.1.0` → `0.1.0`).

## Licence

Copyright (C) 2026 PK Digital.

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, version 3.
See [LICENSE](LICENSE). Ghostscript and MuPDF are © Artifex Software, Inc., also under the AGPL-3.0.

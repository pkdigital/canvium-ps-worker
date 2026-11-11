# canvium-ps-worker

A small HTTP service that converts PostScript (`.ps`) and Encapsulated PostScript (`.eps`) to PDF
by running [Ghostscript](https://ghostscript.com/).

It is the PostScript converter for [Canvium](https://canvium.com), which renders previews and
thumbnails from the PDF. It is published on its own, under the GNU Affero General Public License
v3, because it ships Ghostscript (AGPL-3.0).

## How it uses Ghostscript

- Ghostscript is the unmodified `ghostscript` package from Debian bookworm, installed in the image.
- It is run as a separate program (`gs`) for each request. Nothing links against `libgs`.
- It runs with `-dSAFER`, so a document can't read or write files or run commands. In production
  the container also has no network access.
- Source for the Ghostscript in the image: `apt-get source ghostscript` on Debian bookworm, or the
  matching release at <https://ghostscript.com/releases/>. `GET /health` reports the version.

## API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/convert` | PostScript or EPS bytes | `200 application/pdf`; `422` JSON `{ error }` if the file can't be converted; `413` if over the size limit |
| `GET` | `/health` | | `{ ok, ghostscript, source }` |

EPS pages are cropped to the file's `%%BoundingBox`. Multi-page PostScript keeps every page.

Settings (environment): `PORT` (default 8080), `GS_TIMEOUT_MS` (default 120000), `MAX_BYTES`
(default 200 MB).

## Run it

```sh
docker build -t canvium-ps-worker .
docker run --rm -p 8080:8080 canvium-ps-worker
curl -X POST --data-binary @drawing.eps localhost:8080/convert -o drawing.pdf
```

Or with Node 22+ and Ghostscript installed: `npm install && npm run dev`. Tests: `npm test`.

Images are published to `ghcr.io/pkdigital/canvium-ps-worker` from `main` (tag `main`) and from
version tags (`v0.1.0` → `0.1.0`).

## Licence

Copyright (C) 2026 PK Digital.

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, version 3.
See [LICENSE](LICENSE). Ghostscript is © Artifex Software, Inc., also under the AGPL-3.0.

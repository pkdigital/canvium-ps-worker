# canvium-ps-worker: PostScript/EPS -> PDF, and PDF page -> PNG, over HTTP.
# Ghostscript and MuPDF are Debian's unmodified packages, run as separate programs (never linked).
# Sources: `apt-get source ghostscript mupdf` (Debian bookworm), https://ghostscript.com/releases/
# and https://mupdf.com/releases/
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini ghostscript mupdf-tools \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY LICENSE README.md ./

ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "src/server.ts"]

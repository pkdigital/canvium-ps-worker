# canvium-ps-worker: PostScript/EPS -> PDF over HTTP.
# Ghostscript is Debian's unmodified package, run as a separate program (never linked).
# Its source: `apt-get source ghostscript` (Debian bookworm) or https://ghostscript.com/releases/
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini ghostscript \
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

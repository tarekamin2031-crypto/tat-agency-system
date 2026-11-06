# NOTE: build context for this Dockerfile is the REPO ROOT (see docker-compose.yml),
# because it needs to copy the shared /database folder alongside the backend code.
FROM node:20-alpine

# System Chromium + Arabic-capable fonts, used by puppeteer-core to render
# branded invoice PDFs (RTL Arabic text needs real font + shaping support).
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-arabic

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY backend/scripts ./scripts
COPY database /database

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]

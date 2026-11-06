# Hugging Face Space (Docker) for the TAT backend.
# The Space itself only holds THIS file + README.md. The application code is pulled from your PRIVATE
# GitHub repo at build time with a read-only token stored as the Space secret GITHUB_TOKEN,
# so the code is never published on Hugging Face (the Space has to be public for the browser to reach the API).
FROM node:20-alpine

RUN apk add --no-cache git chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto font-noto-arabic

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    PORT=7860

# Build-time secret (never written into the image layers: .git is removed and the repo copy is deleted below)
RUN --mount=type=secret,id=GITHUB_TOKEN,mode=0444,required=true \
    git clone --depth 1 "https://x-access-token:$(cat /run/secrets/GITHUB_TOKEN)@github.com/tarekamin2031-crypto/tat-agency-system.git" /repo

WORKDIR /app
RUN cp /repo/backend/package*.json ./ && npm install --omit=dev \
 && cp -r /repo/backend/src ./src \
 && cp -r /repo/database /database \
 && rm -rf /repo \
 && chown -R node:node /app /database

# Hugging Face runs Spaces as a non-root user (uid 1000 = "node" in this image)
USER node
EXPOSE 7860
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]

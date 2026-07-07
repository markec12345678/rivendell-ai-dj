# Dockerfile for Rivendell AI DJ — works on Render, Railway, HF Spaces, Fly.io
FROM node:22-slim

# Install ffmpeg (for Piper TTS, if used) + curl (healthcheck)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Demo mode by default (simulated Rivendell — no real Rivendell needed)
ENV DEMO_MODE=true
# PORT is set by Render/Railway/HF at runtime. Default 7701 for local.
# Do NOT hardcode — let the platform inject PORT.
ENV PORT=7701
EXPOSE 7701

# Use existing 'node' user (UID 1000 in node:22-slim)
RUN chown -R node:node /app
USER node

# Healthcheck uses $PORT (resolved at runtime via shell form)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-7701}/api/state" > /dev/null || exit 1

CMD ["node", "src/cli.js"]

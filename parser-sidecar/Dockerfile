# Parser sidecar — owns the Java dependency so app/worker images stay slim
# (ingest-UX spec §7; future OCR engine plugs in here as another route).
FROM node:20-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/parser
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.mjs ./
EXPOSE 7800
USER node
CMD ["node", "server.mjs"]

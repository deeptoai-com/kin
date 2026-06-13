# Parser sidecar — owns the Java dependency so app/worker images stay slim
# (ingest-UX spec §7; future OCR engine plugs in here as another route).
FROM node:20-slim
# openjdk = opendataloader-pdf (text-layer parse); poppler-utils = pdftoppm (OCR O1-b: PDF→PNG)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless poppler-utils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/parser
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.mjs ./
EXPOSE 7800
USER node
CMD ["node", "server.mjs"]

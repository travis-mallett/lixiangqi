FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dist/package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY dist/ ./
COPY public/ ./public/
ENV HOST=0.0.0.0 PORT=6175 LIXIANGQI_PUBLIC=/app/public
USER node
EXPOSE 6175
CMD ["node", "server.mjs"]

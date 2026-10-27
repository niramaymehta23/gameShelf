FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_FILE=/data/db.json PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server/index.js"]

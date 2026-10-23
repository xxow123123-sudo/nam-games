FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY assets ./assets
RUN mkdir -p data && chown -R node:node /app
USER node
CMD ["node", "src/index.js"]

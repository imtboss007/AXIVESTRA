FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.mjs"]

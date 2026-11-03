FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY web ./web
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev && npm cache clean --force
RUN node --input-type=module -e "import fs from 'node:fs'; const p=JSON.parse(fs.readFileSync('package.json')); fs.writeFileSync('package.json',JSON.stringify({name:p.name,version:p.version,type:p.type,license:p.license,engines:p.engines}));"

FROM node:24-bookworm-slim AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY server ./server
COPY LICENSE NOTICE ./
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server/index.js"]

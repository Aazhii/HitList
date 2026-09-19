FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npx vite build --mode appsail && \
    npx esbuild server/notes-server.ts --bundle --platform=node --target=node20 --format=esm --packages=external --outfile=server.js && \
    npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dist ./dist
USER node
EXPOSE 9000
CMD ["node", "server.js"]

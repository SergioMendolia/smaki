# --- development (used by docker compose) ---
FROM node:24.21.0-bookworm-slim AS development
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --- build ---
FROM node:24.21.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- production ---
FROM node:24.21.0-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/.output ./.output
COPY --from=build /app/server/database/migrations ./server/database/migrations
COPY --from=build /app/content ./content
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
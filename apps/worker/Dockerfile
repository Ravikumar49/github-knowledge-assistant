FROM node:20-alpine

# Install git (CRITICAL for cloning repos in the background worker)
RUN apk add --no-cache git

WORKDIR /app

RUN npm install -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/worker

CMD ["npx", "tsx", "src/index.ts"]
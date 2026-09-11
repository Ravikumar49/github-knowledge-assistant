FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy the entire monorepo into the container
COPY . .

# Install dependencies strictly from the lockfile
RUN pnpm install --frozen-lockfile

# Move into the API directory
WORKDIR /app/apps/api

# Generate the Prisma client inside Linux Container
RUN npx prisma generate

# Expose the port
EXPOSE 4000

# Start the Express server
CMD ["npx", "tsx", "src/index.ts"]
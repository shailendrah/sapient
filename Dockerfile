FROM node:20-slim

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy package files first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source
COPY shared/ shared/
COPY backend/ backend/
COPY frontend/ frontend/

# Copy bundled workspace (used to seed ~/.sapient/workspace/ on first run)
COPY workspace/ workspace/

# Build all workspaces
RUN pnpm -r build

# State directory
RUN mkdir -p /root/.sapient && chmod 700 /root/.sapient
VOLUME /root/.sapient

# Gateway port
EXPOSE 18789

# Default command — workspace defaults to ~/.sapient/workspace/ (seeded from /app/workspace)
CMD ["node", "frontend/dist/src/cli/index.js", "start", "--bind", "lan"]

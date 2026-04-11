FROM node:20-slim

# Install Java (required for SQLcl), Python (required for stock-trading MCP), and pnpm
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

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

# Copy bundled workspace defaults (used to seed ~/.sapient/workspace/ on first run)
COPY workspace-defaults/ workspace-defaults/

# Copy MCP servers and install their dependencies
COPY mcp-servers/ mcp-servers/
RUN cd mcp-servers/embed && npm install --omit=dev --platform=linux --arch=x64
RUN cd mcp-servers/oracle-proxy && npm install --omit=dev
RUN cd mcp-servers/slack && npm install --omit=dev
RUN pip3 install --no-cache-dir --break-system-packages \
    mcp yfinance pandas numpy scipy

# Install SQLcl (Oracle SQL command-line with MCP server support)
COPY sqlcl/ /usr/local/sqlcl/
ENV PATH="/usr/local/sqlcl/bin:${PATH}"

# Install Claude Code CLI (required by Claude Agent SDK)
RUN npm install -g @anthropic-ai/claude-code@latest

# Build all workspaces
RUN pnpm -r build

# State directory
RUN mkdir -p /root/.sapient && chmod 700 /root/.sapient
VOLUME /root/.sapient

# Gateway port
EXPOSE 18789

# Default command — workspace defaults to ~/.sapient/workspace/ (seeded from /app/workspace)
CMD ["node", "frontend/dist/src/cli/index.js", "start", "--bind", "lan"]

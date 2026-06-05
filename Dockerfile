# --- STAGE 1: Base ---
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y \
    git grep openssl libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- STAGE 2: Builder ---
FROM base AS builder
COPY package*.json tsconfig*.json ./
COPY packages ./packages
RUN npm install
RUN npm run build

# --- STAGE 3: Hub Production ---
FROM base AS hub-production
RUN mkdir -p /app/knowledge-hub && chown -R node:node /app
USER node
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/packages/librarian-shared ./packages/librarian-shared
COPY --chown=node:node --from=builder /app/packages/librarian-hub-mcp ./packages/librarian-hub-mcp
RUN npm install --omit=dev --workspace=@librarian/hub-mcp && npm cache clean --force
ENV KNOWLEDGE_HUB_PATH=/app/knowledge-hub
CMD ["node", "packages/librarian-hub-mcp/build/index.js"]

# --- STAGE 4: Git Production ---
FROM base AS git-production
RUN mkdir -p /app/knowledge-hub && chown -R node:node /app
USER node
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/packages/librarian-git-mcp ./packages/librarian-git-mcp
RUN npm install --omit=dev --workspace=@librarian/git-mcp && npm cache clean --force
RUN git config --global user.name "AI Librarian" && \
    git config --global user.email "librarian@knowledge-hub.local" && \
    git config --global --add safe.directory /app/knowledge-hub
ENV KNOWLEDGE_HUB_PATH=/app/knowledge-hub
CMD ["node", "packages/librarian-git-mcp/build/index.js"]

# --- STAGE 5: Search Production ---
FROM base AS search-production
RUN mkdir -p /app/knowledge-hub && chown -R node:node /app
USER node
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/packages/librarian-shared ./packages/librarian-shared
COPY --chown=node:node --from=builder /app/packages/librarian-search-mcp ./packages/librarian-search-mcp
RUN npm install --omit=dev --workspace=@librarian/search-mcp && npm cache clean --force
ENV KNOWLEDGE_HUB_PATH=/app/knowledge-hub
CMD ["node", "packages/librarian-search-mcp/build/index.js"]

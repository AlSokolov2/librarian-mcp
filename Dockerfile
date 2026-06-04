# --- STAGE 1: Base ---
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y \
    git grep openssl libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- STAGE 2: Builder ---
FROM base AS builder
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# --- STAGE 3: Production (The Actual Image) ---
FROM base AS production

# Настраиваем пользователя ПЕРЕД копированием и установкой
RUN mkdir -p /app/knowledge-hub && chown -R node:node /app
USER node

# Копируем артефакты сборки с правильными правами (одним слоем)
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/build ./build

# Устанавливаем зависимости и чистим кэш в одной команде
RUN npm install --omit=dev && npm cache clean --force

# Настраиваем Git (уже под пользователем node)
RUN git config --global user.name "AI Librarian" && \
    git config --global user.email "librarian@knowledge-hub.local" && \
    git config --global --add safe.directory /app/knowledge-hub

ENV KNOWLEDGE_HUB_PATH=/app/knowledge-hub
EXPOSE 3000
CMD ["node", "build/index.js"]

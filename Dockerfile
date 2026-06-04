# --- STAGE 1: Base (System Dependencies) ---
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    git \
    grep \
    openssl \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- STAGE 2: Development (All dependencies + Source) ---
FROM base AS development

# Мы не переключаемся на пользователя node здесь, чтобы было проще
# управлять монтируемыми томами из WSL/Windows, если нужно.
# Но для безопасности в рантайме можно будет переключиться.

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

# Копируем всё для возможности запуска тестов и линта внутри
COPY . .

# В режиме dev запускаем через ts-node для мгновенных правок
CMD ["npm", "run", "dev"]

# --- STAGE 3: Builder (Compilation) ---
FROM base AS builder

COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
COPY src/core.ts ./src/core.ts 
RUN npm run build

# --- STAGE 4: Production (Optimized Runtime) ---
FROM base AS production

# Копируем только артефакты сборки
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/build ./build

# Устанавливаем только production-зависимости
RUN npm install --omit=dev && npm cache clean --force

# Настройка прав для безопасности
RUN chown -R node:node /app
USER node
RUN mkdir -p /app/knowledge-hub

# Настраиваем Git Identity
RUN git config --global user.name "AI Librarian" && \
    git config --global user.email "librarian@knowledge-hub.local" && \
    git config --global --add safe.directory /app/knowledge-hub

ENV KNOWLEDGE_HUB_PATH=/app/knowledge-hub
EXPOSE 3000

CMD ["node", "build/index.js"]

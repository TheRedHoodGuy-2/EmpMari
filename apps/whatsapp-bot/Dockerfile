FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY packages/parser/package.json ./packages/parser/
COPY packages/identifier/package.json ./packages/identifier/
COPY packages/humaniser/package.json ./packages/humaniser/
COPY packages/claimer/package.json ./packages/claimer/
COPY packages/activity-log/package.json ./packages/activity-log/
COPY packages/imager/package.json ./packages/imager/
COPY packages/farmer/package.json ./packages/farmer/
COPY packages/personality/package.json ./packages/personality/
COPY apps/whatsapp-bot/package.json ./apps/whatsapp-bot/
RUN pnpm install --frozen-lockfile
COPY packages/ ./packages/
COPY apps/whatsapp-bot/ ./apps/whatsapp-bot/
WORKDIR /app/apps/whatsapp-bot
CMD ["pnpm", "start"]

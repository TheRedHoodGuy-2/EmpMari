FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-workspace.yaml ./
COPY packages/parser/package.json ./packages/parser/
COPY packages/identifier/package.json ./packages/identifier/
COPY packages/humaniser/package.json ./packages/humaniser/
COPY packages/claimer/package.json ./packages/claimer/
COPY packages/activity-log/package.json ./packages/activity-log/
COPY packages/imager/package.json ./packages/imager/
COPY packages/farmer/package.json ./packages/farmer/
COPY packages/personality/package.json ./packages/personality/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --no-frozen-lockfile
COPY . .
WORKDIR /app/apps/dashboard
RUN pnpm build
CMD ["pnpm", "start"]

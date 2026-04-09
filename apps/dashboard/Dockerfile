FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile
WORKDIR /app/apps/dashboard
RUN pnpm build
CMD ["pnpm", "start"]

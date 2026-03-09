FROM node:22-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy application files and build
COPY . .
RUN npm run build

# --- Production Image ---
FROM node:22-slim

WORKDIR /app

# Copy built app and dependencies from builder
COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .

EXPOSE 3000
ENV NODE_ENV=production

# Let adapter-node handle running the server
CMD ["node", "build/index.js"]

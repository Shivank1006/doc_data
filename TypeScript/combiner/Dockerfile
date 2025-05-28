# Stage 1: Build Environment
FROM node:20-slim AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Stage 2: Production Environment
FROM node:20-slim
WORKDIR /app

# Copy package files for pruning
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

# Environment variables
ENV NODE_ENV=production

# Set the command to run the combiner handler
CMD ["node", "dist/handler.js"] 
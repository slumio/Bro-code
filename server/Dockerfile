# Stage 1: Build the project
FROM node:18-alpine AS builder

WORKDIR /build

# Copy package files and install dependencies
COPY package*.json ./

RUN npm ci

# Copy the rest of the source code and build the project
COPY . .

# Build the TypeScript code
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Stage 2: Create production image
FROM node:18-alpine AS runner

WORKDIR /app

# Copy only the necessary files for production
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/public ./public
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package*.json ./

# Expose the port (adjust if needed)
EXPOSE 3000

# Start the compiled server (ensure your package.json points here)
CMD ["node", "dist/server.js"]

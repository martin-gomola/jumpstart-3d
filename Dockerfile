FROM node:22-alpine AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY build.mjs build-revision.mjs react-build.mjs ./
COPY src ./src
COPY third_party ./third_party
COPY mcp/browser ./mcp/browser
COPY mcp/shared ./mcp/shared
COPY mcp/tokens ./mcp/tokens
ARG JUMPSTART_BUILD_REVISION
ENV JUMPSTART_BUILD_REVISION=${JUMPSTART_BUILD_REVISION}
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=build /workspace/build/site ./build/site
COPY mcp/server ./mcp/server
COPY mcp/shared ./mcp/shared

ENV JUMPSTART_MCP_HOST=0.0.0.0
ENV JUMPSTART_MCP_PORT=3210
ENV JUMPSTART_MCP_HTTP_ONLY=1

EXPOSE 3210 3211 3212
CMD ["node", "mcp/server/server.mjs"]

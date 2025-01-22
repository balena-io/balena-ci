# https://hub.docker.com/_/node
FROM node:22.13.1-bullseye-slim as base

WORKDIR /app

ENV DEBIAN_FRONTEND noninteractive

# hadolint ignore=DL3008
RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates git wget unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# renovate: datasource=github-releases depName=balena-io/balena-cli
ARG BALENA_CLI_VERSION=v20.2.3

# Install balena-cli via standlone zip to save install time
RUN wget -q -O balena-cli.zip "https://github.com/balena-io/balena-cli/releases/download/${BALENA_CLI_VERSION}/balena-cli-${BALENA_CLI_VERSION}-linux-x64-standalone.zip" && \
    unzip balena-cli.zip && rm balena-cli.zip

FROM base AS dev

COPY *.json ./

# Install all dependencies required for building
RUN npm ci

FROM dev as build

COPY src/ src/

# Full build with dev devependencies
RUN npm run build

FROM base AS prod

# Copy built files and package files only
COPY --from=build /app/package*.json ./
COPY --from=build /app/build /app/build

# Add balena-cli to PATH
ENV PATH /app/balena-cli:$PATH

# Install production dependencies only
RUN balena version && npm ci --production

COPY entrypoint.sh /app/entrypoint.sh

# Start
ENTRYPOINT [ "/app/entrypoint.sh" ]

FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS builder

WORKDIR /build/web
COPY web/package.json web/bun.lock ./
# muw: 构建机若直连 npmjs 拉包易截断（IntegrityCheckFailed），走 npmmirror（字节级镜像，integrity 与 lockfile 一致）
RUN printf '[install]\nregistry = "https://registry.npmmirror.com"\n' > bunfig.toml && bun install --frozen-lockfile
COPY ./web ./
COPY ./VERSION /build/VERSION
# VERSION 在 Windows 检出可能带 CRLF，注入前统一去掉 \r（否则版本号会变成
# `v26.09.11.muw.8\r`，与 CHANGELOG 标题比对失败）。
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(tr -d '\r' < /build/VERSION) bun run build

FROM golang:1.26.1-alpine@sha256:2389ebfa5b7f43eeafbd6be0c3700cc46690ef842ad962f6c5bd6be49ed82039 AS builder2
ENV GO111MODULE=on CGO_ENABLED=0 GOWORK=off

# GOPROXY 可通过 --build-arg 注入（如 https://goproxy.cn,direct），默认使用
# 官方 proxy.golang.org；大陆网络环境构建时需显式传入国内镜像。
ARG GOPROXY
ENV GOPROXY=${GOPROXY:-https://proxy.golang.org,direct}

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
# relaykit is a local submodule referenced via replace; its go.mod must be
# present for go mod download to resolve the main module graph.
ADD relaykit/go.mod ./relaykit/go.mod
RUN go mod download

COPY . .
COPY --from=builder /build/web/dist ./web/dist
RUN go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(tr -d '\r' < VERSION)'" -o new-api

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=builder2 /build/new-api /
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/new-api"]

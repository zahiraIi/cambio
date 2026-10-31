FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder
ARG TARGETOS TARGETARCH

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o cambio-server ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=builder /app/cambio-server .
COPY web/ ./web/
COPY models/ ./models/

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s --retries=3 CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1
ENV CAMBIO_MODEL_PATH=/app/models/cambio
CMD ["./cambio-server"]

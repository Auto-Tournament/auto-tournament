# Auto Tournament worker: reads CS2 demos after the match.
# One static Go binary; the same code builds for Windows (see README).
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /at-worker .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /at-worker /at-worker
ENTRYPOINT ["/at-worker"]

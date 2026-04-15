BINARY=colosseum

.PHONY: build test run ui-install ui-build dev tidy

build: ui-build
	go build -o bin/$(BINARY) ./cmd/colosseum

test:
	go test ./...

run:
	go run ./cmd/colosseum server

ui-install:
	npm --prefix ui install

ui-build:
	npm --prefix ui run build
	rm -rf internal/api/ui/dist
	mkdir -p internal/api/ui/dist
	cp -r ui/dist/. internal/api/ui/dist/

dev:
	concurrently "go run ./cmd/colosseum server" "npm --prefix ui run dev"

tidy:
	go mod tidy

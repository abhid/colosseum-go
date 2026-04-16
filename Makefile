BINARY=colosseum

.PHONY: build test test-go test-ui lint lint-go lint-ui check run ui-install ui-build dev tidy clean

build: ui-build
	go build -o bin/$(BINARY) ./cmd/colosseum

test: test-go test-ui

test-go:
	go test ./...

test-ui:
	npm --prefix ui run test

lint: lint-go lint-ui

lint-go:
	go vet ./...

lint-ui:
	npm --prefix ui run lint

check: lint test ui-build

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

clean:
	rm -rf bin artifacts build tmp-artifacts workspaces userfiles
	rm -rf ui/dist internal/api/ui/dist
	rm -f *.db *.db-*

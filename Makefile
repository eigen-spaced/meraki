# Meraki dev shortcuts. Run `make` (or `make help`) to list targets.
.PHONY: help dev build deploy migrate test lint fmt debug

help:
	@echo "Meraki targets:"
	@echo "  make dev      One-command dev loop: deploy + Firefox with auto-reload."
	@echo "                Pass a start URL with URL=... e.g. make dev URL=https://github.com"
	@echo "  make build    Bundle the content script (src/ -> extension/content.js)."
	@echo "  make deploy   Deploy the daemon to ~/.local/share/meraki + write the manifest."
	@echo "  make migrate  Run the legacy -> meraki-annotator data migration (one-shot)."
	@echo "  make test     Run the end-to-end daemon tests."
	@echo "  make lint     Lint the Python daemon with ruff."
	@echo "  make fmt      Format Python (ruff) and JS/HTML/CSS/MD (prettier)."
	@echo "  make debug    Run the stable no-reload smoke-test harness (debug/run-debug.sh)."

# Interactive loop: auto-reloads the extension on save, auto-redeploys the
# daemon on save. Ctrl-C stops everything. URL is optional.
dev:
	./dev.sh $(URL)

# Bundle the content script once (dev.sh does this + watches on `make dev`).
build:
	npm run build

# One-shot: (re)deploy the daemon and native-messaging manifest.
deploy:
	python3 -m daemon.install_host

# One-shot legacy-path migration (also runs automatically inside deploy).
migrate:
	python3 -m daemon.migrate

test:
	python3 -m tests.test_daemon

lint:
	ruff check daemon tests

# Python via ruff; web assets via prettier (fetched on demand by npx).
fmt:
	ruff format daemon tests
	npx --yes prettier --write "extension/**/*.{js,html,css}" "*.md"

debug:
	./debug/run-debug.sh

# Short commands for the common workflows. Run `make` to list them.
# Windows without make? Each target is one `uv run ...` line: copy it into your terminal.

.PHONY: help setup demo-data aggregate test serve all screenshots clean

PORT ?= 8000

help:
	@echo ""
	@echo "  make setup       Install Python dependencies (uv sync)"
	@echo "  make demo-data   Generate synthetic microdata → data/raw/   (skip if you have real data)"
	@echo "  make aggregate   Build site/data/aggregates.json from config/survey.toml"
	@echo "  make test        Check the public file is safe to publish"
	@echo "  make serve       Preview at http://localhost:$(PORT)"
	@echo "  make all         setup → demo-data → aggregate → test"
	@echo ""

setup:
	uv sync

demo-data:
	uv run python pipeline/generate_demo_data.py

aggregate:
	uv run python pipeline/build_aggregates.py

test:
	uv run pytest

serve:
	@echo "Open http://localhost:$(PORT)  (Ctrl+C to stop)"
	uv run python -m http.server $(PORT) --directory site

all: setup demo-data aggregate test

clean:
	rm -rf .pytest_cache **/__pycache__

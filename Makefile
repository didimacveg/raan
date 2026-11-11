# RAAN · Open Orbital Intelligence Lab — reproducible pipeline
# `make reproduce` rebuilds every number on the site from public data.
PY ?= .venv/bin/python
SHORTEN_COMMIT := 5ea648955cc65dddd355f167ba1b51cff6cb8648

.PHONY: help setup data catalog collision maneuvers intel report web test lint reproduce clean

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

setup: ## create the virtualenv and install Python + web dependencies
	python3 -m venv .venv
	.venv/bin/pip install -q --upgrade pip
	.venv/bin/pip install -q -e ".[dev,seq,llm]"
	cd web && npm ci

data: data/raw/cac/train_data.csv data/raw/shorten/README.md ## download the research datasets

data/raw/cac/train_data.csv:
	$(PY) -m raan.collision.download

data/raw/shorten/README.md:
	git clone -q https://github.com/dpshorten/TLE_observation_benchmark_dataset data/raw/shorten
	git -C data/raw/shorten checkout -q $(SHORTEN_COMMIT)

catalog: ## polite CelesTrak fetch + rebuild web/public/data/catalog.json
	$(PY) -m raan.catalog.build --fetch

collision: data ## baselines + models on the ESA collision dataset
	$(PY) -m raan.collision.run

maneuvers: data ## manoeuvre detectors on the TLE benchmark
	$(PY) -m raan.maneuver.run

intel: ## regenerate the intelligence report from the artefacts
	$(PY) -m raan.intel.run

report: ## technical report PDF
	$(PY) -m raan.report.build

web: ## production build of the site
	cd web && npm run build

test: ## all tests
	$(PY) -m pytest
	cd web && npx vitest run

lint:
	$(PY) -m ruff check .
	cd web && npx tsc -b

reproduce: data collision maneuvers intel report web ## everything except the live catalogue

clean:
	rm -rf web/dist .pytest_cache .ruff_cache

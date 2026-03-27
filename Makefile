.PHONY: help build start_sapient stop_sapient pair_sapient logs status clean

COMPOSE := docker compose
CONTAINER := sapient
CLI := node frontend/dist/src/cli/index.js

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

build: ## Build the Docker image
	$(COMPOSE) build

start_sapient: ## Start Sapient in foreground (Ctrl+C to stop)
	$(COMPOSE) up --build

stop_sapient: ## Stop the running Sapient container
	$(COMPOSE) down

pair_sapient: ## Pair a device. Usage: make pair_sapient [DEVICE=device-abc123]
ifndef DEVICE
	@echo "Pending device pairing requests:"
	@docker exec $(CONTAINER) $(CLI) device list
else
	@echo "Approving device $(DEVICE)..."
	@docker exec $(CONTAINER) $(CLI) device approve $(DEVICE)
endif

logs: ## Tail container logs
	$(COMPOSE) logs -f

status: ## Show container status
	@docker ps --filter name=$(CONTAINER) --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

clean: ## Remove container, image, and state volume
	$(COMPOSE) down -v --rmi local

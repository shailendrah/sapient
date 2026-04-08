.PHONY: help start_sapient stop_sapient restart_sapient pair_sapient logs status clean

COMPOSE := docker compose
CONTAINER := sapient
CLI := node frontend/dist/src/cli/index.js

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

start_sapient: ## Build and start Sapient (detached). Use 'make logs' to tail output.
	$(COMPOSE) up --build -d
	@echo ""
	@echo "Sapient started. Run 'make logs' to see output, 'make status' to check."

restart_sapient: ## Restart without rebuilding
	$(COMPOSE) restart
	@echo "Restarted."

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

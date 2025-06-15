.PHONY: build up down logs clean dev test

# build and start all services
up:
	docker-compose up --build -d

# stop all services
down:
	docker-compose down

# build images
build:
	docker-compose build

# view logs
logs:
	docker-compose logs -f

# view specific service logs
logs-api:
	docker-compose logs -f api

logs-worker:
	docker-compose logs -f mail-worker

logs-db:
	docker-compose logs -f db

# scale mail workers
scale-workers:
	docker-compose up --scale mail-worker=5 -d

# clean up everything
clean:
	docker-compose down -v
	docker system prune -f

# development mode (with file watching)
dev:
	npm run dev

# run tests
test:
	npm test

# database operations
db-reset:
	docker-compose down -v
	docker-compose up db -d
	sleep 10
	docker-compose up --build -d

# check service health
health:
	docker-compose ps 
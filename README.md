# Mail Scheduler

A TypeScript application that sends birthday messages to users at 9 AM in their local timezone.

## Features

- REST API for user management (CREATE, UPDATE, DELETE)
- Automatic birthday message scheduling
- Timezone-aware message delivery
- Horizontal scaling support for mail workers
- PostgreSQL database with proper indexing
- Docker containerization

## Quick Start

### Using Docker (Recommended)

1. **Start all services:**
   ```bash
   make up
   ```

2. **Scale mail workers:**
   ```bash
   make scale-workers
   ```

3. **View logs:**
   ```bash
   make logs
   ```

### Manual Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your database URL
   ```

3. **Build and start:**
   ```bash
   npm run build
   npm start
   ```

## API Endpoints

### Create User
```bash
POST /user
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "birthday": "1990-05-15",
  "timezone": "America/New_York"
}
```

### Update User
```bash
PUT /user/:id
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Smith",
  "email": "john.smith@example.com",
  "birthday": "1990-05-15",
  "timezone": "America/Los_Angeles"
}
```

### Delete User
```bash
DELETE /user/:id
```

## Architecture

- **API Server**: Handles user CRUD operations
- **Mail Workers**: Process scheduled messages (horizontally scalable)
- **PostgreSQL**: Stores users and message queue
- **Docker**: Containerization and orchestration

## Scaling

The mail workers can be scaled horizontally using Docker Compose:

```bash
docker-compose up --scale mail-worker=5 -d
```

The system uses PostgreSQL's `FOR UPDATE SKIP LOCKED` to prevent race conditions between workers.

## Development

```bash
# Start in development mode
npm run dev

# Start worker in development mode
npm run dev:worker

# Build TypeScript
npm run build
```

## Available Make Commands

- `make up` - Start all services
- `make down` - Stop all services
- `make logs` - View all logs
- `make scale-workers` - Scale to 5 workers
- `make clean` - Clean up everything
- `make db-reset` - Reset database
- `make health` - Check service health 
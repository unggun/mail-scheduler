-- users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    birthday DATE NOT NULL,
    timezone VARCHAR(50) NOT NULL,  -- example: 'Asia/Jakarta'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- outbox table for scheduled messages
CREATE TABLE IF NOT EXISTS outbox (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    scheduled_time TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, sent
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- unique constraint to prevent duplicate scheduled messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_unique_schedule 
ON outbox (user_id, event_type, scheduled_time) 
WHERE status = 'pending';


-- indexes for faster read
CREATE INDEX IF NOT EXISTS idx_outbox_processing 
ON outbox (status, scheduled_time) 
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
import { Pool } from 'pg';

// Mock axios for email sending tests
jest.mock('axios');

// Create test database pool FIRST
export const testPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres:password@localhost:5432/mailscheduler_test',
});

// Force override the actual database pool with test pool
jest.mock('../src/db', () => ({
    pool: testPool,
}), { virtual: false });

// Ensure database URL is set for tests
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:password@localhost:5432/mailscheduler_test';

// Global test setup
beforeAll(async () => {
    // Ensure test database is clean
    try {
        await testPool.query('DELETE FROM outbox');
        await testPool.query('DELETE FROM users');
    } catch (error) {
        console.error('Database cleanup failed:', error);
    }
});

afterAll(async () => {
    // Clean up after all tests
    try {
        await testPool.query('DELETE FROM outbox');
        await testPool.query('DELETE FROM users');
        await testPool.end();
    } catch (error) {
        console.error('Database cleanup failed:', error);
    }
});

// Clean up BEFORE each test to ensure clean starting state
beforeEach(async () => {
    jest.clearAllMocks();
    try {
        // Clean in proper order due to foreign key constraints
        await testPool.query('DELETE FROM outbox');
        await testPool.query('DELETE FROM users');
    } catch (error) {
        console.error('Database cleanup failed:', error);
    }
});

// Don't clean up AFTER tests to avoid race conditions
afterEach(async () => {
    jest.clearAllMocks();
});

// Test utilities
export const createTestUser = async (overrides: any = {}, autoSchedule: boolean = true) => {
    const timestamp = Date.now();
    const randomId = Math.floor(Math.random() * 10000);
    const defaultUser = {
        first_name: 'Test',
        last_name: 'User',
        email: `test${timestamp}${randomId}@example.com`,
        birthday: '1990-01-15',
        timezone: 'Asia/Jakarta',
        ...overrides,
    };

    const result = await testPool.query(
        `INSERT INTO users (first_name, last_name, email, birthday, timezone)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [defaultUser.first_name, defaultUser.last_name, defaultUser.email, defaultUser.birthday, defaultUser.timezone]
    );

    const user = result.rows[0];

    // Automatically schedule mail job for the test user unless disabled
    if (autoSchedule) {
        const { scheduleNextMailJob } = require('../src/mailScheduler');
        // Don't pass testPool as client to avoid confusion with pool vs client
        await scheduleNextMailJob(user);
    }

    return user;
};

export const createTestOutboxEntry = async (userId: number, overrides: any = {}) => {
    const defaultEntry = {
        user_id: userId,
        event_type: 'birthday',
        scheduled_time: new Date(),
        status: 'pending',
        ...overrides,
    };

    const result = await testPool.query(
        `INSERT INTO outbox (user_id, event_type, scheduled_time, status)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [defaultEntry.user_id, defaultEntry.event_type, defaultEntry.scheduled_time, defaultEntry.status]
    );

    return result.rows[0];
}; 
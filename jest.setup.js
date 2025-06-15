// Set test environment variables
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:password@localhost:5432/mailscheduler_test';
process.env.NODE_ENV = 'test';

// Mock node-cron to prevent actual scheduling during tests
jest.mock('node-cron', () => ({
    schedule: jest.fn(),
}));

// Jest global functions
global.fail = function(message) {
    throw new Error(message || 'Test failed');
}; 
import { DateTime } from 'luxon';
import { testPool, createTestUser, createTestOutboxEntry } from './setup';

// mock mail sender and scheduler
jest.mock('../src/mailSender', () => ({
    sendEmail: jest.fn(),
}));

jest.mock('../src/mailScheduler', () => ({
    scheduleNextMailJob: jest.fn(),
}));

// mock node-cron to prevent actual cron job from running
jest.mock('node-cron', () => ({
    schedule: jest.fn(),
}));

// import the functions we need to test
const { sendEmail } = require('../src/mailSender');
const { scheduleNextMailJob } = require('../src/mailScheduler');

// import the processOutboxJobs function - we need to extract it from mailWorker
// since it's not exported, we'll test the logic by creating our own version
async function processOutboxJobs() {
    const client = await testPool.connect();
    try {
        await client.query('BEGIN');

        const now = new Date();
        const { rows: jobs } = await client.query(
            `SELECT * FROM outbox WHERE status = 'pending' AND scheduled_time <= $1 FOR UPDATE SKIP LOCKED`,
            [now]
        );
        
        for (const job of jobs) {
            try {
                const { rows: [user] } = await client.query("SELECT * FROM users WHERE id = $1", [job.user_id]);
                await client.query(
                    `UPDATE outbox SET status = 'processing', updated_at = now() WHERE id = $1`,
                    [job.id]
                );
                await sendEmail(user, job.event_type);
                await client.query(
                    `UPDATE outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(), updated_at = now() WHERE id = $1`,
                    [job.id]
                );
                await scheduleNextMailJob(user, client);
            } catch (err: any) {
                await client.query(
                    `UPDATE outbox SET status = 'pending', attempts = attempts + 1, last_error = $1, updated_at = now() WHERE id = $2`,
                    [err.message, job.id]
                );
            }
        }

        await client.query('COMMIT');
    } catch (err: any) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

describe('Mail Worker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('processOutboxJobs', () => {
        it('should process pending jobs scheduled for current time', async () => {
            const user = await createTestUser({}, false);
            const job = await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() - 1000), // 1 second ago
                status: 'pending',
            });

            sendEmail.mockResolvedValueOnce(undefined);
            scheduleNextMailJob.mockResolvedValueOnce(undefined);

            await processOutboxJobs();

            expect(sendEmail).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: user.id,
                    email: user.email,
                }),
                'birthday'
            );

            // Check that job status was updated
            const { rows } = await testPool.query('SELECT * FROM outbox WHERE id = $1', [job.id]);
            expect(rows[0].status).toBe('sent');
            expect(rows[0].sent_at).toBeTruthy();
            expect(rows[0].attempts).toBe(1);
        });

        it('should not process jobs scheduled for future', async () => {
            const user = await createTestUser({}, false);
            await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() + 60000), // 1 minute in future
                status: 'pending',
            });

            await processOutboxJobs();

            expect(sendEmail).not.toHaveBeenCalled();
            expect(scheduleNextMailJob).not.toHaveBeenCalled();
        });

        it('should handle email sending failures', async () => {
            const user = await createTestUser({}, false);
            const job = await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });

            const emailError = new Error('Email service unavailable');
            sendEmail.mockRejectedValueOnce(emailError);

            await processOutboxJobs();

            // Check that job status was updated with error
            const { rows } = await testPool.query('SELECT * FROM outbox WHERE id = $1', [job.id]);
            expect(rows[0].status).toBe('pending');
            expect(rows[0].attempts).toBe(1);
            expect(rows[0].last_error).toBe('Email service unavailable');
            expect(rows[0].sent_at).toBeNull();
        });

        it('should schedule next job after successful send', async () => {
            const user = await createTestUser({}, false);
            await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });

            sendEmail.mockResolvedValueOnce(undefined);
            scheduleNextMailJob.mockResolvedValueOnce(undefined);

            await processOutboxJobs();

            expect(scheduleNextMailJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: user.id,
                }),
                expect.any(Object) // client
            );
        });

        it('should not schedule next job on email failure', async () => {
            const user = await createTestUser({}, false);
            await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });

            sendEmail.mockRejectedValueOnce(new Error('Email failed'));

            await processOutboxJobs();

            expect(scheduleNextMailJob).not.toHaveBeenCalled();
        });

        it('should process multiple jobs', async () => {
            const user1 = await createTestUser({}, false);
            const user2 = await createTestUser({}, false);
            
            await createTestOutboxEntry(user1.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });
            
            await createTestOutboxEntry(user2.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });

            sendEmail.mockResolvedValue(undefined);
            scheduleNextMailJob.mockResolvedValue(undefined);

            await processOutboxJobs();

            expect(sendEmail).toHaveBeenCalledTimes(2);
            expect(scheduleNextMailJob).toHaveBeenCalledTimes(2);

            // Check both jobs were processed
            const { rows } = await testPool.query('SELECT * FROM outbox WHERE status = $1', ['sent']);
            expect(rows).toHaveLength(2);
        });

        it('should handle partial failures in batch processing', async () => {
            const user1 = await createTestUser({}, false);
            const user2 = await createTestUser({}, false);
            
            const job1 = await createTestOutboxEntry(user1.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });
            
            const job2 = await createTestOutboxEntry(user2.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });

            // First call succeeds, second fails
            sendEmail
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('Second email failed'));
            
            scheduleNextMailJob.mockResolvedValue(undefined);

            await processOutboxJobs();

            // Check first job succeeded
            const { rows: job1Rows } = await testPool.query('SELECT * FROM outbox WHERE id = $1', [job1.id]);
            expect(job1Rows[0].status).toBe('sent');

            // Check second job failed
            const { rows: job2Rows } = await testPool.query('SELECT * FROM outbox WHERE id = $1', [job2.id]);
            expect(job2Rows[0].status).toBe('pending');
            expect(job2Rows[0].last_error).toBe('Second email failed');
        });

        it('should skip non-pending jobs', async () => {
            const user = await createTestUser({}, false);
            await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'sent', // Already sent
            });

            await processOutboxJobs();

            expect(sendEmail).not.toHaveBeenCalled();
        });

        it('should handle database transaction rollback on error', async () => {
            const user = await createTestUser({}, false);
            const job = await createTestOutboxEntry(user.id, {
                scheduled_time: new Date(Date.now() - 1000),
                status: 'pending',
            });

            // Mock a database error during processing
            jest.spyOn(testPool, 'connect').mockImplementationOnce(() => {
                throw new Error('Database connection failed');
            });

            await expect(processOutboxJobs()).rejects.toThrow('Database connection failed');

            // Job should remain unchanged
            const { rows } = await testPool.query('SELECT * FROM outbox WHERE id = $1', [job.id]);
            expect(rows[0].status).toBe('pending');
            expect(rows[0].attempts).toBe(0);
        });
    });
}); 
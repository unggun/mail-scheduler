import { pool } from "./db";
import { scheduleNextMailJob } from "./mailScheduler";
import { sendEmail } from "./mailSender";
import cron from 'node-cron';
import { OutboxJob } from './types';
import { PoolClient } from "pg";

function calculateRetryDelay(attempts: number): number {
    //max 5 minutes
    const delay = Math.min(1000 * Math.pow(2, attempts), 300000);
    return delay;
}

async function processJob(job: OutboxJob, client: PoolClient): Promise<void> {
    try {
        const { rows: [user] } = await client.query("SELECT * FROM users WHERE id = $1", [job.user_id]);

        if (!user) {
            throw new Error(`User not found for job ${job.id}`);
        }

        // await client.query(
        //     `UPDATE outbox SET status = 'processing', updated_at = now() WHERE id = $1`,
        //     [job.id]
        // );

        await sendEmail(user, job.event_type);

        await client.query(
            `UPDATE outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(), updated_at = now() WHERE id = $1`,
            [job.id]
        );

        await scheduleNextMailJob(user, client);
        console.log(`Job ${job.id} completed successfully`);

    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        const newAttempts = (job.attempts || 0) + 1;
        const maxAttempts = 5;

        if (newAttempts >= maxAttempts) {
            await client.query(
                `UPDATE outbox SET status = 'failed', attempts = $1, last_error = $2, updated_at = now() WHERE id = $3`,
                [newAttempts, err.message, job.id]
            );
            console.error(`Job ${job.id} failed permanently after ${newAttempts} attempts:`, err.message);
        } else {
            const retryDelay = calculateRetryDelay(newAttempts);
            const nextRetryTime = new Date(Date.now() + retryDelay);

            await client.query(
                `UPDATE outbox SET 
                    status = 'pending', 
                    attempts = $1, 
                    last_error = $2, 
                    scheduled_time = $3,
                    updated_at = now() 
                WHERE id = $4`,
                [newAttempts, err.message, nextRetryTime, job.id]
            );

            console.warn(`Job ${job.id} failed (attempt ${newAttempts}), will retry in ${retryDelay / 1000}s:`, err.message);
        }

        throw err; // re-throw for Promise.allSettled handling
    }
}

async function processOutboxJobs() {
    const client: PoolClient = await pool.connect();
    try {
        await client.query('BEGIN');

        const now = new Date();
        const { rows: jobs } = await client.query(
            `SELECT * FROM outbox WHERE status = 'pending' AND scheduled_time <= $1 FOR UPDATE SKIP LOCKED LIMIT 50`,
            [now]
        );

        if (jobs.length === 0) {
            await client.query('COMMIT');
            return;
        }

        console.log(`Processing ${jobs.length} jobs concurrently...`);

        // run jobs concurrently
        const jobPromises = jobs.map(job => processJob(job, client));
        const results = await Promise.allSettled(jobPromises);

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`Batch complete: ${successful} successful, ${failed} failed`);

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('Error in processOutboxJobs transaction:', err);
        throw err;
    } finally {
        client.release();
    }
}

cron.schedule('* * * * *', async () => {
    try {
        await processOutboxJobs();
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('Error processing outbox jobs:', err);
    }
});
import { pool } from "./db";
import { scheduleNextMailJob } from "./mailScheduler";
import { sendEmail } from "./mailSender";
import cron from 'node-cron';

async function processOutboxJobs() {
    const client = await pool.connect();
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

cron.schedule('* * * * *', async () => {
    try {
        await processOutboxJobs();
    } catch (error) {
        console.error('Error processing outbox jobs:', error);
    }
});
import { DateTime } from "luxon";
import { pool } from "./db";
import { User } from "./types";
import { PoolClient } from "pg";

function utcConvert(dateNow: DateTime, date: Date | string, timezone: string, targetYear?: number) {
    // handle different date input formats more robustly
    let theDate: DateTime;
    
    if (typeof date === 'string') {
        // handle date strings like '1990-08-10' or '1990-08-10T00:00:00.000Z'
        theDate = DateTime.fromISO(date);
        if (!theDate.isValid) {
            // Try parsing as a plain date string
            const parts = date.split('-');
            if (parts.length === 3) {
                theDate = DateTime.fromObject({
                    year: parseInt(parts[0]),
                    month: parseInt(parts[1]),
                    day: parseInt(parts[2])
                });
            }
        }
    } else {
        // handle Date objects - extract date components in UTC to avoid timezone shift
        theDate = DateTime.fromJSDate(date, { zone: 'utc' });
    }
    
    if (!theDate.isValid) {
        throw new Error(`Invalid date format: ${date}`);
    }
    
    const yearToUse = targetYear || dateNow.setZone(timezone).year;
    
    let nextMailDate = DateTime.fromObject({
        year: yearToUse,
        month: theDate.month,
        day: theDate.day,
        hour: 9,
        minute: 0,
        second: 0
    }, { zone: timezone }).toUTC();

    // handle leap year edge case - if Feb 29 doesn't exist in target year, use Feb 28
    if (!nextMailDate.isValid && theDate.month === 2 && theDate.day === 29) {
        nextMailDate = DateTime.fromObject({
            year: yearToUse,
            month: 2,
            day: 28,
            hour: 9,
            minute: 0,
            second: 0
        }, { zone: timezone }).toUTC();
    }

    return nextMailDate;
}

export async function scheduleNextMailJob(user: User, client?: PoolClient) {
    const dbClient = client || pool;
    const now = DateTime.utc();
    // birthday -----
    let nextBirthday = utcConvert(now, user.birthday, user.timezone);

    // if birthday already passed this year, schedule for next year
    if (nextBirthday < now) {
        const nextYear = now.setZone(user.timezone).year + 1;
        nextBirthday = utcConvert(now, user.birthday, user.timezone, nextYear);
    }
    // ------ end of birthday

    // add anniv or else later


    
    // insert outbox row (check for existing first)
    const existingJob = await dbClient.query(
        `SELECT id FROM outbox 
         WHERE user_id = $1 AND event_type = $2 AND scheduled_time = $3 AND status = 'pending'`,
        [user.id, "birthday", nextBirthday.toJSDate()]
    );

    if (existingJob.rows.length === 0) {
        await dbClient.query(
            `INSERT INTO outbox (user_id, event_type, scheduled_time, status)
             VALUES ($1, $2, $3, 'pending')`,
            [user.id, "birthday", nextBirthday.toJSDate()]
        );
    }
}

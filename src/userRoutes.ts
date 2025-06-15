import express from "express";
import { pool } from "./db";
import { scheduleNextMailJob } from "./mailScheduler";

const router = express.Router();

router.post("/user", async (req, res) => {
    const { first_name, last_name, email, birthday, timezone } = req.body;
    
    // validate input
    if (!first_name || !last_name || !email || !birthday || !timezone) {
        res.status(400).json({ error: "Missing required fields" });
        return;
    }

    // check if user already exists
    const { rows: [existingUser] } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existingUser) {
        res.status(400).json({ error: "User already exists" });
        return;
    }

    const result = await pool.query(
        `INSERT INTO users (first_name, last_name, email, birthday, timezone)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [first_name, last_name, email, birthday, timezone]
    );
    const user = result.rows[0];

    await scheduleNextMailJob(user, pool);

    res.json(user);
});

router.delete("/user/:id", async (req, res) => {
    const { id } = req.params;
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    await pool.query("DELETE FROM outbox WHERE user_id = $1", [id]);

    res.sendStatus(204);
});

router.put("/user/:id", async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, email, birthday, timezone } = req.body;

    const result = await pool.query(
        `UPDATE users 
        SET first_name=$1, last_name=$2, email=$3, birthday=$4, timezone=$5, updated_at=now()
        WHERE id=$6 RETURNING *`,
        [first_name, last_name, email, birthday, timezone, id]
    );
    const user = result.rows[0];

    //delete old job
    await pool.query("DELETE FROM outbox WHERE user_id = $1", [id]);

    // Reschedule mail job
    await scheduleNextMailJob(user, pool);

    res.json(user);
});

export default router;
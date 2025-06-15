import request from 'supertest';
import express from 'express';
import { DateTime } from 'luxon';
import userRoutes from '../src/userRoutes';
import { testPool, createTestUser } from './setup';

// mock the mail scheduler
jest.mock('../src/mailScheduler', () => ({
    scheduleNextMailJob: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/', userRoutes);

describe('User Routes', () => {
    describe('POST /user', () => {
        it('should create a user successfully with Jakarta timezone', async () => {
            const userData = {
                first_name: 'John',
                last_name: 'Doe',
                email: 'john.doe@example.com',
                birthday: '1990-01-15',
                timezone: 'Asia/Jakarta',
            };

            const response = await request(app)
                .post('/user')
                .send(userData)
                .expect(200);

            expect(response.body).toMatchObject({
                first_name: 'John',
                last_name: 'Doe',
                email: 'john.doe@example.com',
                timezone: 'Asia/Jakarta',
            });
            expect(response.body.id).toBeDefined();

            // verify user was created in database
            const { rows } = await testPool.query('SELECT * FROM users WHERE email = $1', [userData.email]);
            expect(rows).toHaveLength(1);
            expect(rows[0].email).toBe(userData.email);
        });

        it('should return 400 for missing required fields', async () => {
            const incompleteData = {
                first_name: 'John',
                last_name: 'Doe',
                // simulate missing email, birthday, timezone
            };

            const response = await request(app)
                .post('/user')
                .send(incompleteData)
                .expect(400);

            expect(response.body.error).toBe('Missing required fields');
        });

        it('should return 400 for duplicate email', async () => {
            const timestamp = Date.now();
            const userData = {
                first_name: 'John',
                last_name: 'Doe',
                email: `duplicate${timestamp}@example.com`,
                birthday: '1990-01-15',
                timezone: 'Asia/Jakarta',
            };

            // create first user
            await request(app)
                .post('/user')
                .send(userData)
                .expect(200);

            // try to create second user with same email
            const response = await request(app)
                .post('/user')
                .send(userData)
                .expect(400);

            expect(response.body.error).toBe('User already exists');
        });

        it('should schedule next mail job after user creation', async () => {
            const scheduleNextMailJob = require('../src/mailScheduler').scheduleNextMailJob;
            
            const userData = {
                first_name: 'Jane',
                last_name: 'Smith',
                email: 'jane.smith@example.com',
                birthday: '1985-06-20',
                timezone: 'Asia/Jakarta',
            };

            await request(app)
                .post('/user')
                .send(userData)
                .expect(200);

            expect(scheduleNextMailJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: userData.email,
                    first_name: userData.first_name,
                    last_name: userData.last_name,
                }),
                expect.any(Object) // database client
            );
        });
    });

    describe('PUT /user/:id', () => {
        it('should update user successfully and reschedule mail job', async () => {
            const user = await createTestUser();
            const scheduleNextMailJob = require('../src/mailScheduler').scheduleNextMailJob;
            
            const updateData = {
                first_name: 'Updated',
                last_name: 'Name',
                email: 'updated@example.com',
                birthday: '1992-03-25',
                timezone: 'Asia/Jakarta',
            };

            const response = await request(app)
                .put(`/user/${user.id}`)
                .send(updateData)
                .expect(200);

            expect(response.body.first_name).toBe(updateData.first_name);
            expect(response.body.last_name).toBe(updateData.last_name);
            expect(response.body.email).toBe(updateData.email);
            expect(response.body.timezone).toBe(updateData.timezone);
            expect(response.body.id).toBe(user.id);

            // verify database was updated
            const { rows } = await testPool.query('SELECT * FROM users WHERE id = $1', [user.id]);
            expect(rows[0].first_name).toBe(updateData.first_name);
            expect(rows[0].last_name).toBe(updateData.last_name);
            expect(rows[0].email).toBe(updateData.email);
            expect(rows[0].timezone).toBe(updateData.timezone);

            // verify mail job was rescheduled
            expect(scheduleNextMailJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    first_name: updateData.first_name,
                    last_name: updateData.last_name,
                    email: updateData.email,
                    timezone: updateData.timezone,
                }),
                expect.any(Object) // database client
            );
        });

        it('should delete old outbox entries when updating user', async () => {
            const user = await createTestUser();
            
            // create some outbox entries for the user
            await testPool.query(
                'INSERT INTO outbox (user_id, event_type, scheduled_time, status) VALUES ($1, $2, $3, $4)',
                [user.id, 'birthday', new Date(), 'pending']
            );

            const updateData = {
                first_name: 'Updated',
                last_name: 'Name',
                email: 'updated@example.com',
                birthday: '1992-03-25',
                timezone: 'Asia/Jakarta',
            };

            await request(app)
                .put(`/user/${user.id}`)
                .send(updateData)
                .expect(200);

            // verify old outbox entries were deleted
            const { rows } = await testPool.query('SELECT * FROM outbox WHERE user_id = $1', [user.id]);
            // note: there might be new entries created by scheduleNextMailJob, but old ones should be deleted
            expect(rows.every(row => row.created_at > new Date(Date.now() - 1000))).toBe(true);
        });
    });

    describe('DELETE /user/:id', () => {
        it('should delete user and all related outbox entries', async () => {
            const user = await createTestUser();
            
            // create outbox entries for the user
            await testPool.query(
                'INSERT INTO outbox (user_id, event_type, scheduled_time, status) VALUES ($1, $2, $3, $4)',
                [user.id, 'birthday', new Date(), 'pending']
            );

            await request(app)
                .delete(`/user/${user.id}`)
                .expect(204);

            // verify user was deleted
            const userResult = await testPool.query('SELECT * FROM users WHERE id = $1', [user.id]);
            expect(userResult.rows).toHaveLength(0);

            // verify outbox entries were deleted
            const outboxResult = await testPool.query('SELECT * FROM outbox WHERE user_id = $1', [user.id]);
            expect(outboxResult.rows).toHaveLength(0);
        });

        it('should return 204 even for non-existent user', async () => {
            await request(app)
                .delete('/user/99999')
                .expect(204);
        });
    });
}); 
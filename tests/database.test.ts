import { testPool } from './setup';

// Jest global functions
declare global {
    function fail(message?: string): never;
}

describe('Database Tests', () => {
    describe('Connection', () => {
        it('should successfully connect to test database', async () => {
            const client = await testPool.connect();
            expect(client).toBeDefined();
            
            // Test a simple query
            const result = await client.query('SELECT 1 as test');
            expect(result.rows[0].test).toBe(1);
            
            client.release();
        });

        it('should handle multiple concurrent connections', async () => {
            const connectionPromises: Promise<any>[] = [];
            const connectionCount = 5;

            for (let i = 0; i < connectionCount; i++) {
                connectionPromises.push(testPool.connect());
            }

            const clients = await Promise.all(connectionPromises);
            expect(clients).toHaveLength(connectionCount);

            // Test queries on all connections
            const queryPromises = clients.map((client, index) => 
                client.query('SELECT $1 as client_id', [index])
            );

            const results = await Promise.all(queryPromises);
            
            results.forEach((result, index) => {
                expect(result.rows[0].client_id).toBe(index.toString());
            });

            // Release all connections
            clients.forEach(client => client.release());
        });

        it('should handle query errors gracefully', async () => {
            const client = await testPool.connect();
            
            try {
                // Intentionally invalid SQL
                await client.query('SELECT FROM invalid_table');
                fail('Expected query to throw an error');
            } catch (error: any) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toContain('does not exist');
            } finally {
                client.release();
            }
        });
    });

    describe('Table Operations', () => {
        it('should validate users table structure', async () => {
            const result = await testPool.query(`
                SELECT column_name, data_type, is_nullable 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                ORDER BY ordinal_position
            `);

            const columns = result.rows;
            expect(columns.length).toBeGreaterThan(0);

            // Check for required columns
            const columnNames = columns.map(col => col.column_name);
            expect(columnNames).toContain('id');
            expect(columnNames).toContain('first_name');
            expect(columnNames).toContain('last_name');
            expect(columnNames).toContain('email');
            expect(columnNames).toContain('birthday');
            expect(columnNames).toContain('timezone');
            expect(columnNames).toContain('created_at');
            expect(columnNames).toContain('updated_at');
        });

        it('should validate outbox table structure', async () => {
            const result = await testPool.query(`
                SELECT column_name, data_type, is_nullable 
                FROM information_schema.columns 
                WHERE table_name = 'outbox' 
                ORDER BY ordinal_position
            `);

            const columns = result.rows;
            expect(columns.length).toBeGreaterThan(0);

            // Check for required columns
            const columnNames = columns.map(col => col.column_name);
            expect(columnNames).toContain('id');
            expect(columnNames).toContain('user_id');
            expect(columnNames).toContain('event_type');
            expect(columnNames).toContain('scheduled_time');
            expect(columnNames).toContain('status');
            expect(columnNames).toContain('attempts');
            expect(columnNames).toContain('last_error');
            expect(columnNames).toContain('sent_at');
            expect(columnNames).toContain('created_at');
            expect(columnNames).toContain('updated_at');
        });

        it('should validate foreign key constraints', async () => {
            // Create a user
            const userResult = await testPool.query(`
                INSERT INTO users (first_name, last_name, email, birthday, timezone)
                VALUES ('FK', 'Test', $1, '1990-01-01', 'Asia/Jakarta')
                RETURNING id
            `, [`fk${Date.now()}@example.com`]);
            const userId = userResult.rows[0].id;

            // Create outbox entry referencing the user
            const outboxResult = await testPool.query(`
                INSERT INTO outbox (user_id, event_type, scheduled_time, status)
                VALUES ($1, 'birthday', now(), 'pending')
                RETURNING id
            `, [userId]);
            
            expect(outboxResult.rows).toHaveLength(1);

            // Try to create outbox entry with non-existent user_id
            try {
                await testPool.query(`
                    INSERT INTO outbox (user_id, event_type, scheduled_time, status)
                    VALUES (99999, 'birthday', now(), 'pending')
                `);
                fail('Expected foreign key constraint to prevent this insert');
            } catch (error: any) {
                expect((error as Error).message).toContain('foreign key constraint');
            }
        });

        it('should validate unique constraints', async () => {
            const uniqueEmail = `unique${Date.now()}@example.com`;
            const userData = ['Unique', 'Test', uniqueEmail, '1990-01-01', 'Asia/Jakarta'];
            
            // First insert should succeed
            await testPool.query(`
                INSERT INTO users (first_name, last_name, email, birthday, timezone)
                VALUES ($1, $2, $3, $4, $5)
            `, userData);

            // Second insert with same email should fail
            try {
                await testPool.query(`
                    INSERT INTO users (first_name, last_name, email, birthday, timezone)
                    VALUES ($1, $2, $3, $4, $5)
                `, userData);
                fail('Expected unique constraint to prevent duplicate email');
            } catch (error: any) {
                expect((error as Error).message).toContain('duplicate key');
            }
        });
    });

    describe('Data Integrity', () => {
        it('should maintain data consistency during concurrent operations', async () => {
            // Create a user
            const userResult = await testPool.query(`
                INSERT INTO users (first_name, last_name, email, birthday, timezone)
                VALUES ('Concurrent', 'Test', $1, '1990-01-01', 'Asia/Jakarta')
                RETURNING id
            `, [`concurrent${Date.now()}@example.com`]);
            const userId = userResult.rows[0].id;

            // Create multiple outbox entries concurrently
            const insertPromises: Promise<any>[] = [];
            for (let i = 0; i < 5; i++) {
                insertPromises.push(
                    testPool.query(`
                        INSERT INTO outbox (user_id, event_type, scheduled_time, status)
                        VALUES ($1, 'birthday', now() + interval '${i} day', 'pending')
                    `, [userId])
                );
            }

            await Promise.all(insertPromises);

            // Verify all entries were created
            const result = await testPool.query(`
                SELECT COUNT(*) as count 
                FROM outbox 
                WHERE user_id = $1
            `, [userId]);

            expect(parseInt(result.rows[0].count)).toBe(5);
        });

        it('should handle transaction rollbacks correctly', async () => {
            const client = await testPool.connect();
            
            try {
                await client.query('BEGIN');
                
                // Insert a user
                const userResult = await client.query(`
                    INSERT INTO users (first_name, last_name, email, birthday, timezone)
                    VALUES ('Rollback', 'Test', $1, '1990-01-01', 'Asia/Jakarta')
                    RETURNING id
                `, [`rollback${Date.now()}@example.com`]);
                const userId = userResult.rows[0].id;

                // Insert outbox entry
                await client.query(`
                    INSERT INTO outbox (user_id, event_type, scheduled_time, status)
                    VALUES ($1, 'birthday', now(), 'pending')
                `, [userId]);

                // Intentionally rollback
                await client.query('ROLLBACK');

                // Verify nothing was actually committed
                const userCheck = await testPool.query(`
                    SELECT COUNT(*) as count 
                    FROM users 
                    WHERE email LIKE 'rollback%@example.com'
                `);
                
                expect(parseInt(userCheck.rows[0].count)).toBe(0);

                const outboxCheck = await testPool.query(`
                    SELECT COUNT(*) as count 
                    FROM outbox 
                    WHERE user_id = $1
                `, [userId]);
                
                expect(parseInt(outboxCheck.rows[0].count)).toBe(0);
                
            } finally {
                client.release();
            }
        });
    });

    describe('Performance', () => {
        it('should handle bulk operations efficiently', async () => {
            const startTime = Date.now();
            const recordCount = 100;

            // Bulk insert users
            const values: string[] = [];
            const placeholders: string[] = [];
            
            for (let i = 0; i < recordCount; i++) {
                const offset = i * 5;
                placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
                values.push(`Bulk${i}`, `User${i}`, `bulk${i}@example.com`, '1990-01-01', 'Asia/Jakarta');
            }

            const query = `
                INSERT INTO users (first_name, last_name, email, birthday, timezone)
                VALUES ${placeholders.join(', ')}
            `;

            await testPool.query(query, values);

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should complete reasonably quickly
            expect(duration).toBeLessThan(2000); // Less than 2 seconds

            // Verify all records were inserted
            const result = await testPool.query(`
                SELECT COUNT(*) as count 
                FROM users 
                WHERE email LIKE 'bulk%@example.com'
            `);

            expect(parseInt(result.rows[0].count)).toBe(recordCount);
        });

        it('should handle concurrent reads efficiently', async () => {
            // Create some test data
            const readEmail = `read${Date.now()}@example.com`;
            await testPool.query(`
                INSERT INTO users (first_name, last_name, email, birthday, timezone)
                VALUES ('Read', 'Test', $1, '1990-01-01', 'Asia/Jakarta')
            `, [readEmail]);

            const startTime = Date.now();
            const queryCount = 20;

            // Execute multiple concurrent reads
            const queryPromises: Promise<any>[] = [];
            for (let i = 0; i < queryCount; i++) {
                queryPromises.push(
                    testPool.query('SELECT * FROM users WHERE email = $1', [readEmail])
                );
            }

            const results = await Promise.all(queryPromises);
            const endTime = Date.now();
            const duration = endTime - startTime;

            // All queries should succeed
            results.forEach(result => {
                expect(result.rows).toHaveLength(1);
                expect(result.rows[0].email).toBe(readEmail);
            });

            // Should complete reasonably quickly
            expect(duration).toBeLessThan(1000); // Less than 1 second
        });
    });
}); 
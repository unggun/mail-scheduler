import axios from 'axios';
import { sendEmail } from '../src/mailSender';
import { createTestUser } from './setup';
import { User } from '../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Helper function to create complete user objects for testing
const createCompleteUser = (overrides: Partial<User> = {}): User => ({
    id: 1,
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    birthday: new Date('1990-01-01'),
    timezone: 'Asia/Jakarta',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
});

describe('Mail Sender', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('sendEmail', () => {
        it('should send birthday email successfully', async () => {
            const user = createCompleteUser();

            const mockResponse = {
                data: { status: 'sent', sentTime: '2024-01-15T09:00:00Z' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {},
            };

            mockedAxios.post.mockResolvedValueOnce(mockResponse as any);

            await sendEmail(user, 'birthday');

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://email-service.digitalenvision.com.au/send-email',
                {
                    email: 'john.doe@example.com',
                    message: 'Tangi, John Doe, selamat serta mulia!',
                },
                { timeout: 10000 }
            );
        });

        it('should format birthday message correctly', async () => {
            const user = createCompleteUser({
                id: 2,
                first_name: 'Jane',
                last_name: 'Smith',
                email: 'jane.smith@example.com',
            });

            const mockResponse = {
                data: { status: 'sent' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {},
            };

            mockedAxios.post.mockResolvedValueOnce(mockResponse as any);

            await sendEmail(user, 'birthday');

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    message: 'Tangi, Jane Smith, selamat serta mulia!',
                }),
                expect.any(Object)
            );
        });

        it('should throw error for invalid event type', async () => {
            const user = createCompleteUser();

            await expect(sendEmail(user, 'invalid_event')).rejects.toThrow(
                'Invalid event type: invalid_event'
            );

            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('should handle API timeout', async () => {
            const user = createCompleteUser();

            const timeoutError = new Error('Timeout');
            timeoutError.name = 'ECONNABORTED';
            mockedAxios.post.mockRejectedValueOnce(timeoutError);

            await expect(sendEmail(user, 'birthday')).rejects.toThrow('Timeout');

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                { timeout: 10000 }
            );
        });

        it('should handle API server errors', async () => {
            const user = createCompleteUser();

            const serverError = {
                response: {
                    status: 500,
                    data: { error: 'Internal Server Error' },
                },
            };

            mockedAxios.post.mockRejectedValueOnce(serverError);

            await expect(sendEmail(user, 'birthday')).rejects.toMatchObject(serverError);
        });

        it('should handle network errors', async () => {
            const user = createCompleteUser();

            const networkError = new Error('Network Error');
            mockedAxios.post.mockRejectedValueOnce(networkError);

            await expect(sendEmail(user, 'birthday')).rejects.toThrow('Network Error');
        });

        it('should log request payload and response', async () => {
            const user = createCompleteUser();

            const mockResponse = {
                data: { status: 'sent', sentTime: '2024-01-15T09:00:00Z' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {},
            };

            mockedAxios.post.mockResolvedValueOnce(mockResponse as any);

            // mock console.log to capture logs
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            await sendEmail(user, 'birthday');

            expect(consoleSpy).toHaveBeenCalledWith({
                email: 'john.doe@example.com',
                message: 'Tangi, John Doe, selamat serta mulia!',
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                'Email service response:',
                { status: 'sent', sentTime: '2024-01-15T09:00:00Z' },
                'Status:',
                200
            );

            consoleSpy.mockRestore();
        });

        it('should handle special characters in names', async () => {
            const user = createCompleteUser({
                first_name: 'José',
                last_name: 'García-López',
                email: 'jose.garcia@example.com',
            });

            const mockResponse = {
                data: { status: 'sent' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {},
            };

            mockedAxios.post.mockResolvedValueOnce(mockResponse as any);

            await sendEmail(user, 'birthday');

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    message: 'Tangi, José García-López, selamat serta mulia!',
                }),
                expect.any(Object)
            );
        });

        it('should use correct timeout value', async () => {
            const user = createCompleteUser();

            const mockResponse = {
                data: { status: 'sent' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {},
            };

            mockedAxios.post.mockResolvedValueOnce(mockResponse as any);

            await sendEmail(user, 'birthday');

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                { timeout: 10000 }
            );
        });
    });
}); 
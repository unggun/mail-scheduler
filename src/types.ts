export interface OutboxJob {
    id: number;
    user_id: number;
    event_type: string;
    scheduled_time: Date;
    status: 'pending' | 'processing' | 'sent' | 'failed';
    attempts: number;
    last_error?: string;
    sent_at?: Date;
    created_at: Date;
    updated_at: Date;
}

export interface User {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    birthday: Date;
    timezone: string;
    created_at: Date;
    updated_at: Date;
}
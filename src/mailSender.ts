import axios from "axios";
import { User } from "./types";

export async function sendEmail(user: User, eventType: string) {
    const url = "https://email-service.digitalenvision.com.au/send-email";
    let message = "";

    switch (eventType) {
        case "birthday":
            message = `Tangi, ${user.first_name} ${user.last_name}, selamat serta mulia!`;
            break;
        // add anniv or else later
        default:
            throw new Error(`Invalid event type: ${eventType}`);
            break;
    }

    const payload = {
        email: user.email,
        message: message,
    };
    console.log(payload);

    const response = await axios.post(url, payload, { timeout: 10000 }); // assume 10s timeout
    console.log('Email service response:', response.data, 'Status:', response.status);
    
}
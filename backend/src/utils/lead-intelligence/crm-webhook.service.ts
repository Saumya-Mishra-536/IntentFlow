export class CrmWebhookService {
    async dispatchLeadUpdate(tenant_id: string, user_id: string, score: number, segment: string) {
        // Stub for sending data to Salesforce / Hubspot
        console.log(`[CRM Webhook] Dispatched Lead Update -> User: ${user_id}, Score: ${score}, Segment: ${segment}`);
        // implementation would go here: HTTP POST to endpoint
    }
}

export const crmWebhookService = new CrmWebhookService();

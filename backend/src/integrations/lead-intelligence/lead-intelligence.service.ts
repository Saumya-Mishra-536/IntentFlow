import { prisma } from '../../utils/prisma';

export class LeadIntelligenceService {
    private readonly MODEL_VERSION = 'v1-demo';

    async extractSignalsFromTurn(tenant_id: string, user_id: string, turn_id: string, prompt_text: string) {
        // Dummy extraction logic
        const signals: Array<{ type: string; value: any; confidence: number }> = [];

        const lower = prompt_text.toLowerCase();
        if (lower.includes('budget') || lower.includes('price') || lower.includes('cost')) {
            signals.push({ type: 'budget_intent', value: { mention: true }, confidence: 0.8 });
        }
        if (lower.includes('competitor') || lower.includes('vs')) {
            signals.push({ type: 'competitor_comparison', value: { mention: true }, confidence: 0.7 });
        }
        if (lower.includes('buy') || lower.includes('purchase') || lower.includes('upgrade')) {
            signals.push({ type: 'purchase_intent', value: { mention: true }, confidence: 0.9 });
        }

        if (signals.length === 0) return [];

        const createdSignals = await Promise.all(
            signals.map((s) =>
                prisma.leadSignal.create({
                    data: {
                        tenant_id,
                        user_id,
                        signal_type: s.type,
                        value: s.value,
                        confidence: s.confidence,
                        source_turn_id: turn_id,
                    },
                })
            )
        );

        // After extracting, update user's lead score.
        await this.computeLeadScore(tenant_id, user_id);

        return createdSignals;
    }

    async computeLeadScore(tenant_id: string, user_id: string) {
        const signals = await prisma.leadSignal.findMany({
            where: { tenant_id, user_id },
        });

        let score = 0;
        signals.forEach((s: any) => {
            score += s.confidence * 10; // Simple base multiplier
        });

        const segment = score > 50 ? 'Hot' : score > 20 ? 'Warm' : 'Cold';

        await prisma.user.update({
            where: { id: user_id },
            data: {
                lead_score_current: score,
                lead_segment: segment,
                lead_score_updated_at: new Date(),
                scoring_model_version: this.MODEL_VERSION,
            },
        });

        return { score, segment };
    }
}

export const leadIntelligenceService = new LeadIntelligenceService();

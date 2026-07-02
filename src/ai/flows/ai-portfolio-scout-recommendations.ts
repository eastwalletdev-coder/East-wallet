// AI Portfolio Scout — powered by Claude API with web search

export type AIPortfolioScoutRecommendationsOutput = {
  recommendations: Array<{
    type: 'rebalance' | 'opportunity';
    summary: string;
    details: string;
    actionableSteps: string[];
    estimatedImpact?: string;
  }>;
  generalAdvice?: string;
};

export async function aiPortfolioScoutRecommendations(input: {
  portfolio: string;
  marketTrends?: string;
  investmentGoals?: string;
}): Promise<AIPortfolioScoutRecommendationsOutput> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `You are a DeFi portfolio analyst. Analyze this crypto portfolio and give actionable recommendations.

Portfolio: ${input.portfolio}
Goals: ${input.investmentGoals || 'Maximize long-term growth'}

Search for current market conditions, then provide recommendations. 
Return ONLY a JSON object with no markdown or explanation:
{
  "recommendations": [
    {
      "type": "rebalance" or "opportunity",
      "summary": "short title",
      "details": "2-3 sentence explanation",
      "actionableSteps": ["step 1", "step 2", "step 3"],
      "estimatedImpact": "e.g. +15% APY"
    }
  ],
  "generalAdvice": "one sentence overall advice"
}`
      }]
    })
  });

  const data = await response.json();
  const text = data.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    // Fallback jika parse gagal
  }

  return {
    recommendations: [{
      type: 'opportunity',
      summary: 'Market Analysis Complete',
      details: text.slice(0, 200),
      actionableSteps: ['Review your current allocation', 'Consider diversifying across L2s', 'Monitor gas fees before transacting'],
      estimatedImpact: 'Varies'
    }],
    generalAdvice: 'Always do your own research before making investment decisions.'
  };
}

"use client";

import { useEffect, useState } from "react";
import { aiMarketSentimentAnalysis, type AiMarketSentimentAnalysisOutput } from "@/ai/flows/ai-market-sentiment-analysis";
import { getMarketTrendInsights, type AiMarketTrendInsightsOutput } from "@/ai/flows/ai-market-trend-insights";
import { BrainCircuit, Sparkles, TrendingUp, AlertCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface MarketInsightsProps {
  tradingPair: string;
}

export function MarketInsights({ tradingPair }: MarketInsightsProps) {
  const [sentiment, setSentiment] = useState<AiMarketSentimentAnalysisOutput | null>(null);
  const [insight, setInsight] = useState<AiMarketTrendInsightsOutput | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      // Mock data for demo purposes - in real app would use real state
      const orderBookDepth = JSON.stringify({
        bids: [{ price: 41200, quantity: 1.5 }, { price: 41190, quantity: 2.3 }],
        asks: [{ price: 41210, quantity: 0.8 }, { price: 41220, quantity: 4.1 }]
      });
      const transactionHistory = JSON.stringify([
        { price: 41205, quantity: 0.1, type: "buy", timestamp: Date.now() }
      ]);

      const [sentimentData, trendData] = await Promise.all([
        aiMarketSentimentAnalysis({ tradingPair, orderBookDepth, transactionHistory }),
        getMarketTrendInsights({ tradingPair, orderBookData: orderBookDepth, transactionHistory })
      ]);

      setSentiment(sentimentData);
      setInsight(trendData);
    } catch (error) {
      console.error("AI Insights Error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, [tradingPair]);

  return (
    <div className="p-4 h-full flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-xs tracking-tight uppercase text-muted-foreground">EAST Intelligence</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchInsights} disabled={loading} className="h-8 w-8 text-primary">
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex flex-col gap-4 flex-1">
        {loading ? (
          <>
            <Skeleton className="h-24 w-full bg-secondary/50 rounded-xl" />
            <Skeleton className="h-24 w-full bg-secondary/50 rounded-xl" />
          </>
        ) : (
          <>
            <div className="bg-secondary/30 rounded-xl p-4 border border-border flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-bold flex items-center gap-1 uppercase tracking-wider">
                  <TrendingUp className="w-3 h-3" /> Sentiment
                </span>
                <Badge 
                  className={
                    sentiment?.sentiment === 'Bullish' ? 'bg-chart-2/20 text-chart-2 border-chart-2/30' : 
                    sentiment?.sentiment === 'Bearish' ? 'bg-chart-3/20 text-chart-3 border-chart-3/30' : 
                    'bg-muted text-muted-foreground'
                  }
                >
                  {sentiment?.sentiment || 'Neutral'}
                </Badge>
              </div>
              <p className="text-xs leading-relaxed text-foreground/90 italic font-medium">
                "{sentiment?.explanation}"
              </p>
            </div>

            <div className="bg-primary/5 rounded-xl p-4 border border-primary/20 flex flex-col gap-3 glow-primary/10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="text-[10px] text-primary font-bold uppercase tracking-wider">Prediction</span>
              </div>
              <p className="text-xs leading-relaxed font-medium">
                {insight?.insight}
              </p>
              <div className="mt-2 flex items-start gap-1 text-[9px] text-muted-foreground leading-tight">
                <AlertCircle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                <span>AI analysis based on live flow. Not financial advice.</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

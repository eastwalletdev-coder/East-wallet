
"use client"

import { useState } from 'react';
import { aiPortfolioScoutRecommendations, type AIPortfolioScoutRecommendationsOutput } from '@/ai/flows/ai-portfolio-scout-recommendations';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, Loader2, ChevronRight, TrendingUp, Info, Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AIScoutProps {
  accounts: any[];
}

export function AIScout({ accounts }: AIScoutProps) {
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<AIPortfolioScoutRecommendationsOutput | null>(null);

  const handleScout = async () => {
    setLoading(true);
    
    // Create a dynamic summary based on real account data
    const portfolioText = accounts.length > 0 
      ? accounts.map(a => `${a.chain}: ${a.balance}`).join(', ')
      : "No assets found (0.00 balances across all chains)";

    try {
      const result = await aiPortfolioScoutRecommendations({
        portfolio: portfolioText,
        marketTrends: "Ethereum scaling solutions (L2s) are seeing massive TVL growth. DeFi protocols like Aave are introducing high-yield staking vaults. Base ecosystem is expanding rapidly.",
        investmentGoals: "Maximize long-term growth and find yield-bearing opportunities."
      });
      setRecommendations(result);
    } catch (error) {
      console.error("Scouting failed", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="glass border-primary/20 bg-primary/5 overflow-hidden rounded-[2.5rem]">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/20 rounded-xl">
                <Sparkles className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <h3 className="font-headline font-bold text-lg">AI Smart Scout</h3>
            </div>
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary uppercase font-bold px-2 py-0">Active</Badge>
          </div>
          
          <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
            I've analyzed the market trends for you. Should I scan your current holdings for optimization strategies?
          </p>

          <Button 
            onClick={handleScout} 
            disabled={loading}
            className="w-full bg-primary text-primary-foreground font-bold h-12 rounded-2xl shadow-lg shadow-primary/20"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Lightbulb className="w-4 h-4 mr-2" />
            )}
            {loading ? 'Analyzing Data...' : 'Get AI Optimization'}
          </Button>
        </CardContent>
      </Card>

      {recommendations && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-2 mb-2 px-1">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Personalized Insights</span>
          </div>
          {recommendations.recommendations.map((rec, idx) => (
            <div key={idx} className="glass border-primary/10 hover:border-primary/30 transition-all p-5 rounded-3xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-2 opacity-5">
                 {rec.type === 'rebalance' ? <TrendingUp className="w-12 h-12" /> : <Sparkles className="w-12 h-12" /> }
               </div>
              <div className="flex items-start justify-between mb-3">
                <Badge className={cn(
                  "border-none font-bold text-[9px]",
                  rec.type === 'rebalance' ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'
                )}>
                  {rec.type.toUpperCase()}
                </Badge>
                {rec.estimatedImpact && (
                  <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">{rec.estimatedImpact}</span>
                )}
              </div>
              <h4 className="font-bold text-sm mb-1">{rec.summary}</h4>
              <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
                {rec.details}
              </p>
              <div className="space-y-1.5">
                {rec.actionableSteps.map((step, sIdx) => (
                  <div key={sIdx} className="flex items-center gap-2 text-[10px] font-medium text-foreground/90 bg-secondary/30 p-2 rounded-xl">
                    <ChevronRight className="w-3 h-3 text-primary" />
                    {step}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {recommendations.generalAdvice && (
            <div className="p-4 bg-accent/5 border border-accent/20 rounded-2xl flex gap-3">
              <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <p className="text-[10px] text-accent-foreground leading-relaxed italic font-medium">
                "{recommendations.generalAdvice}"
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

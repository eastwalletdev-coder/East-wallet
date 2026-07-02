"use client"

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldCheck, Loader2, Search, AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type RiskLevel = 'safe' | 'warning' | 'danger' | null;

type AnalysisResult = {
  riskLevel: RiskLevel;
  riskScore: number; // 0-100, makin tinggi makin berbahaya
  contractName?: string;
  summary: string;
  checks: Array<{
    label: string;
    status: 'pass' | 'fail' | 'unknown';
    detail: string;
  }>;
  advice: string;
};

interface ContractAnalyzerProps {
  chain?: string;
}

export function ContractAnalyzer({ chain = 'Ethereum' }: ContractAnalyzerProps) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');

  const analyze = async () => {
    if (!address.trim()) return;
    setLoading(true);
    setResult(null);
    setError('');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Analyze this smart contract address for safety on ${chain} blockchain: ${address}

Search for:
1. Is this contract verified on block explorer?
2. Any audit reports or security issues?
3. Is it a known scam, honeypot, or rug pull?
4. Is contract ownership renounced?
5. Is liquidity locked?
6. Any community warnings about this contract?

Return ONLY a JSON object:
{
  "riskLevel": "safe" or "warning" or "danger",
  "riskScore": 0-100,
  "contractName": "Token Name if found",
  "summary": "2 sentence summary of findings",
  "checks": [
    { "label": "Contract Verified", "status": "pass" or "fail" or "unknown", "detail": "explanation" },
    { "label": "Audit Report", "status": "pass" or "fail" or "unknown", "detail": "explanation" },
    { "label": "Honeypot Risk", "status": "pass" or "fail" or "unknown", "detail": "explanation" },
    { "label": "Ownership Renounced", "status": "pass" or "fail" or "unknown", "detail": "explanation" },
    { "label": "Liquidity Locked", "status": "pass" or "fail" or "unknown", "detail": "explanation" }
  ],
  "advice": "one sentence actionable advice"
}`
          }]
        })
      });

      const data = await response.json();
      const text = data.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        setResult(JSON.parse(match[0]));
      } else {
        setError('Failed to parse analysis result. Try again.');
      }
    } catch {
      setError('Analysis failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const riskColor = {
    safe: 'text-green-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
    null: 'text-muted-foreground',
  }[result?.riskLevel ?? 'null'];

  const riskBg = {
    safe: 'bg-green-500/10 border-green-500/20',
    warning: 'bg-yellow-500/10 border-yellow-500/20',
    danger: 'bg-red-500/10 border-red-500/20',
    null: '',
  }[result?.riskLevel ?? 'null'];

  const RiskIcon = result?.riskLevel === 'safe'
    ? ShieldCheck
    : result?.riskLevel === 'danger'
    ? ShieldAlert
    : Shield;

  const statusIcon = {
    pass: <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />,
    fail: <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />,
    unknown: <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Shield className="w-4 h-4 text-primary" />
        <h2 className="font-headline font-bold text-lg">Contract Analyzer</h2>
        <Badge variant="outline" className="text-[9px] border-primary/30 text-primary uppercase font-bold px-2 py-0 ml-auto">AI Powered</Badge>
      </div>

      <div className="glass border-primary/10 rounded-[2rem] p-5 space-y-4">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Paste a contract address to check for scams, honeypots, audit status, and security risks using AI + live web search.
        </p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="0x... contract address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyze()}
              className="pl-9 h-11 bg-secondary/20 border-white/5 rounded-xl text-[11px] font-mono"
            />
          </div>
          <Button
            onClick={analyze}
            disabled={loading || !address.trim()}
            className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-[10px] uppercase"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Scan'}
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-[10px] text-red-400 font-medium">{error}</p>
          </div>
        )}
      </div>

      {loading && (
        <div className="glass border-primary/10 rounded-[2rem] p-8 flex flex-col items-center gap-3">
          <div className="relative">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <Shield className="absolute -top-1 -right-1 w-4 h-4 text-accent animate-pulse" />
          </div>
          <p className="text-[10px] text-primary uppercase font-bold tracking-[0.2em] animate-pulse">Scanning Contract...</p>
          <p className="text-[9px] text-muted-foreground uppercase font-medium">Searching audit reports & scam databases</p>
        </div>
      )}

      {result && (
        <div className={cn("glass border rounded-[2rem] p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500", riskBg)}>
          {/* Risk Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("p-2.5 rounded-xl", riskBg)}>
                <RiskIcon className={cn("w-5 h-5", riskColor)} />
              </div>
              <div>
                {result.contractName && (
                  <p className="font-bold text-sm">{result.contractName}</p>
                )}
                <p className="text-[9px] font-mono text-muted-foreground">{address.slice(0, 10)}...{address.slice(-6)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className={cn("text-2xl font-headline font-bold", riskColor)}>{result.riskScore}</p>
              <p className="text-[8px] text-muted-foreground uppercase font-bold">Risk Score</p>
            </div>
          </div>

          <Badge className={cn(
            "font-bold text-[10px] uppercase border-none",
            result.riskLevel === 'safe' ? 'bg-green-500/20 text-green-400' :
            result.riskLevel === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          )}>
            {result.riskLevel === 'safe' ? '✓ Safe Contract' :
             result.riskLevel === 'warning' ? '⚠ Exercise Caution' :
             '✕ High Risk'}
          </Badge>

          <p className="text-[11px] text-muted-foreground leading-relaxed">{result.summary}</p>

          {/* Security Checks */}
          <div className="space-y-2">
            {result.checks.map((check, idx) => (
              <div key={idx} className="flex items-start gap-2.5 p-3 bg-secondary/20 rounded-xl">
                {statusIcon[check.status]}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold">{check.label}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Advice */}
          <div className="flex gap-2 p-3 bg-primary/5 border border-primary/10 rounded-xl">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[10px] text-primary/80 leading-relaxed font-medium italic">{result.advice}</p>
          </div>
        </div>
      )}
    </div>
  );
}

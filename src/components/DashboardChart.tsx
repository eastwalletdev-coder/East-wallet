
"use client"

import { Line, LineChart, ResponsiveContainer } from "recharts"

// Data is set to zero to reflect a fresh wallet with no balance history
const data = [
  { value: 0 },
  { value: 0 },
  { value: 0 },
  { value: 0 },
  { value: 0 },
  { value: 0 },
  { value: 0 },
]

export function DashboardChart() {
  return (
    <div className="h-[100px] w-full mt-4 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="hsl(var(--primary))" 
            strokeWidth={3} 
            dot={false}
            animationDuration={1000}
          />
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="hsl(var(--accent))" 
            strokeWidth={1} 
            strokeDasharray="5 5"
            dot={false}
            opacity={0.1}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}


"use client"

import { Line, LineChart, ResponsiveContainer } from "recharts"

// Data diatur ke nol untuk mencerminkan dompet baru yang bersih tanpa riwayat saldo
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

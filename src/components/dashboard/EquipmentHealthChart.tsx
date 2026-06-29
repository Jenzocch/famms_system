'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface HealthData {
  machine_code: string
  score: number
}

function getHealthColor(score: number): string {
  if (score >= 80) return '#10b981'
  if (score >= 60) return '#f59e0b'
  if (score >= 40) return '#ef4444'
  return '#7c3aed'
}

export default function EquipmentHealthChart({ data }: { data: HealthData[] }) {
  if (data.length === 0) {
    return (
      <div className="w-full h-80 flex items-center justify-center bg-gray-50 rounded-lg text-gray-400">
        Tidak ada data kesehatan peralatan
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="machine_code"
          angle={-45}
          textAnchor="end"
          height={80}
          tick={{ fontSize: 12 }}
        />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Bar dataKey="score" radius={[8, 8, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getHealthColor(entry.score)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

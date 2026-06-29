'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DataPoint {
  name: string
  count: number
}

export default function FailureDistributionChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="w-full h-80 flex items-center justify-center bg-gray-50 rounded-lg text-gray-400">
        Tidak ada data
      </div>
    )
  }

  // Sort and limit to top 10
  const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, 10)

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={sorted} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="name"
          angle={-45}
          textAnchor="end"
          height={100}
          interval={0}
          tick={{ fontSize: 12 }}
        />
        <YAxis />
        <Tooltip />
        <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

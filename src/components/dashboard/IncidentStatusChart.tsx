'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'

interface StatusData {
  name: string
  value: number
  color: string
}

export default function IncidentStatusChart({ data }: { data: StatusData[] }) {
  const filtered = data.filter(d => d.value > 0)

  if (filtered.length === 0) {
    return (
      <div className="w-full h-80 flex items-center justify-center bg-gray-50 rounded-lg text-gray-400">
        Tidak ada incident
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={filtered}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, value }) => `${name}: ${value}`}
          outerRadius={100}
          fill="#8884d8"
          dataKey="value"
        >
          {filtered.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

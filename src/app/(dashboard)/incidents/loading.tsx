export default function Loading() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-10 bg-gray-200 rounded-lg" />
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-gray-200 rounded-full w-20" />)}
      </div>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-20 bg-gray-200 rounded-xl" />
      ))}
    </div>
  )
}

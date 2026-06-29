export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded-lg w-1/3" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-200 rounded-xl" />
        ))}
      </div>
      <div className="h-48 bg-gray-200 rounded-xl" />
      <div className="h-48 bg-gray-200 rounded-xl" />
    </div>
  )
}

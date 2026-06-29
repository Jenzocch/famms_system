export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded-lg w-1/3" />
      <div className="h-12 bg-gray-200 rounded-xl" />
      <div className="grid grid-cols-7 gap-1">
        {[...Array(35)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-200 rounded-lg" />
        ))}
      </div>
      <div className="h-40 bg-gray-200 rounded-xl" />
    </div>
  )
}

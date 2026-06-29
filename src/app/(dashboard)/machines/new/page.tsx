import MachineForm from '@/components/machines/MachineForm'

export const metadata = { title: 'Tambah Mesin | FAMMS' }

export default function NewMachinePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Tambah Mesin Baru</h1>
      <MachineForm />
    </div>
  )
}

// Portal pets (veterinary): the animals on the account, what each is due, and what is booked. Read-only — the
// clinical chart stays inside the practice. Before this the portal offered a veterinary client projects, change
// orders and lien waivers, and nothing about the pets they actually bring in. (Vet T12 H6)
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { PawPrint, Calendar, Syringe, AlertTriangle, ArrowRight } from 'lucide-react'
import { usePortal } from './PortalContext'
import { PLink, Spinner, PageTitle, Empty, Section, card, pill, formatDate } from './common'

export interface PortalPet {
  id: string; name: string; species?: string | null; breed?: string | null; sex?: string | null
  dob?: string | null; weightLb?: string | number | null; color?: string | null
  microchip?: string | null; rabiesTag?: string | null; deceased?: boolean | null
  vaccinationsDue?: number
  nextVaccinationDue?: { vaccine: string; dueDate: string } | null
  nextAppointment?: { startTime: string; reason?: string | null } | null
  [key: string]: unknown
}
export interface PortalPetDetail {
  pet: PortalPet
  vaccinations: Array<{ id: string; vaccine: string; givenDate?: string | null; dueDate?: string | null }>
  appointments: Array<{ id: string; startTime: string; endTime?: string | null; reason?: string | null; status: string }>
  visits: Array<{ id: string; visitDate: string; reason?: string | null }>
}

const speciesLabel = (s?: string | null) => {
  const v = String(s || '').toLowerCase()
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Pet'
}
const isPast = (d?: string | null) => !!d && d <= new Date().toISOString().slice(0, 10)

export function PortalPets() {
  const { config, fetch: portalFetch } = usePortal()
  const [pets, setPets] = useState<PortalPet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/pets').then((d) => setPets(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  return (
    <div>
      <PageTitle title={config.labels.pets} subtitle="Your animals, their vaccinations and what is booked." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {pets.length === 0 ? <Empty icon={PawPrint} text="No pets on your account yet." /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pets.map((p) => (
            <PLink key={p.id} to={`pets/${p.id}`} className={`${card} p-5 hover:border-gray-300 hover:shadow-md transition-all block text-gray-900 dark:text-slate-100`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-lg truncate">{p.name}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400 truncate">
                    {speciesLabel(p.species)}{p.breed ? ` · ${p.breed}` : ''}{p.sex ? ` · ${p.sex}` : ''}
                  </p>
                </div>
                <PawPrint className="w-5 h-5 text-teal-600 shrink-0" />
              </div>
              <div className="mt-4 space-y-2 text-sm">
                {!!p.vaccinationsDue && p.vaccinationsDue > 0 && (
                  <p className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {p.vaccinationsDue} vaccination{p.vaccinationsDue === 1 ? '' : 's'} due
                  </p>
                )}
                {p.nextVaccinationDue && (
                  <p className="flex items-center gap-2 text-gray-600 dark:text-slate-400">
                    <Syringe className="w-4 h-4 shrink-0" />
                    {p.nextVaccinationDue.vaccine} due {formatDate(p.nextVaccinationDue.dueDate)}
                  </p>
                )}
                {p.nextAppointment ? (
                  <p className="flex items-center gap-2 text-gray-600 dark:text-slate-400">
                    <Calendar className="w-4 h-4 shrink-0" />
                    {formatDate(p.nextAppointment.startTime)}{p.nextAppointment.reason ? ` — ${p.nextAppointment.reason}` : ''}
                  </p>
                ) : <p className="text-gray-500 dark:text-slate-400">Nothing booked</p>}
              </div>
              <p className="mt-4 text-sm text-teal-700 dark:text-teal-400 inline-flex items-center gap-1">View record <ArrowRight className="w-4 h-4" /></p>
            </PLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function PortalPetDetail() {
  const { petId } = useParams()
  const { fetch: portalFetch } = usePortal()
  const [data, setData] = useState<PortalPetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch(`/pets/${petId}`).then(setData).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch, petId])
  if (loading) return <Spinner />
  if (error || !data) return <p role="alert" className="text-sm text-red-600">{error || 'Pet not found.'}</p>
  const { pet, vaccinations, appointments, visits } = data
  const upcoming = appointments.filter((a) => new Date(a.startTime) >= new Date())
  const past = appointments.filter((a) => new Date(a.startTime) < new Date())
  return (
    <div>
      <PageTitle title={pet.name} subtitle={`${speciesLabel(pet.species)}${pet.breed ? ` · ${pet.breed}` : ''}`} />
      <Section title="Details">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {([['Species', speciesLabel(pet.species)], ['Breed', pet.breed], ['Sex', pet.sex], ['Date of birth', pet.dob ? formatDate(pet.dob) : null],
            ['Weight', pet.weightLb ? `${pet.weightLb} lb` : null], ['Colour', pet.color], ['Microchip', pet.microchip], ['Rabies tag', pet.rabiesTag]] as Array<[string, any]>)
            .filter(([, v]) => v).map(([label, v]) => (
              <div key={label}>
                <dt className="text-gray-500 dark:text-slate-400">{label}</dt>
                <dd className="font-medium text-gray-900 dark:text-slate-100">{String(v)}</dd>
              </div>
            ))}
        </dl>
      </Section>
      <Section title="Vaccinations">
        {vaccinations.length === 0 ? <Empty icon={Syringe} text="No vaccinations recorded." /> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {vaccinations.map((v) => (
              <li key={v.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{v.vaccine}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">Given {v.givenDate ? formatDate(v.givenDate) : '—'}</p>
                </div>
                {v.dueDate && <span className={pill(isPast(v.dueDate) ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700')}>{isPast(v.dueDate) ? 'Due' : 'Due'} {formatDate(v.dueDate)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Appointments">
        {upcoming.length === 0 && past.length === 0 ? <Empty icon={Calendar} text="No appointments." /> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {[...upcoming, ...past].map((a) => (
              <li key={a.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.reason || 'Appointment'}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{formatDate(a.startTime)}</p>
                </div>
                <span className={pill('bg-gray-100 text-gray-700 capitalize')}>{String(a.status).replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {visits.length > 0 && (
        <Section title="Visits">
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {visits.map((v) => (
              <li key={v.id} className="py-3">
                <p className="font-medium">{v.reason || 'Visit'}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">{formatDate(v.visitDate)}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

// Contacts — shared implementation (packages/tenant-backend/src/contacts/contacts.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, middleware and services in.
import { createContactRoutes, standardRelations, standardGuards } from '../shared/index.ts'
import { asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, project, quote, invoice, job, patient, appointment } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { cleanText } from '../utils/sanitize.ts'

export default createContactRoutes({
  db,
  tables: { contact },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  audit,
  cleanText,
  options: {
    relations: [
      ...standardRelations({ project, quote, invoice }),
      // the owner page lists their pets
      { key: 'patients', table: patient, column: patient.ownerId, columns: { id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, deceased: patient.deceased }, orderBy: asc(patient.name) },
    ],
    guards: [
      // A client owns patients, and every patient's visits/vaccinations/prescriptions/lab results
      // cascade-delete with them. That is medical history under statutory retention — block it.
      { table: patient, column: patient.ownerId, label: 'patient', message: (n) => `This client has ${n} patient${n === 1 ? '' : 's'} with medical history. Reassign or remove their patients before deleting the client.` },
      { table: appointment, column: appointment.ownerId, label: 'appointment' },
      ...standardGuards({ invoice, quote, job, project }),
    ],
  },
})

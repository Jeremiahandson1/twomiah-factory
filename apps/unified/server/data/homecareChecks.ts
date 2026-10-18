// The SQL of home care's check constraints (server/db/schema/homecare.ts): raw SQL lives in server/data/ (RULEBOOK §2).
import { sql } from 'drizzle-orm'

/** clients_insurance_front_size_cap */
export const clientsInsuranceFrontSizeCap = (t: any) => sql`${t.insuranceCardFront} IS NULL OR LENGTH(${t.insuranceCardFront}) <= 7000000`

/** clients_insurance_back_size_cap */
export const clientsInsuranceBackSizeCap = (t: any) => sql`${t.insuranceCardBack} IS NULL OR LENGTH(${t.insuranceCardBack}) <= 7000000`

/** client_task_templates_category_check */
export const clientTaskTemplatesCategoryCheck = (t: any) => sql`${t.category} IN ('adl','iadl','medication','companion','safety','other')`

/** client_task_templates_time_of_day_check */
export const clientTaskTemplatesTimeOfDayCheck = (t: any) => sql`${t.timeOfDay} IN ('AM','PM','any')`

/** client_task_templates_cadence_check */
export const clientTaskTemplatesCadenceCheck = (t: any) => sql`${t.cadence} IN ('daily','weekly')`

/** shift_task_completions_status_check */
export const shiftTaskCompletionsStatusCheck = (t: any) => sql`${t.status} IN ('pending','completed','skipped','refused')`

/** vitals_systolic_range */
export const vitalsSystolicRange = (t: any) => sql`${t.systolicBp} IS NULL OR ${t.systolicBp} BETWEEN 50 AND 260`

/** vitals_diastolic_range */
export const vitalsDiastolicRange = (t: any) => sql`${t.diastolicBp} IS NULL OR ${t.diastolicBp} BETWEEN 25 AND 160`

/** vitals_pulse_range */
export const vitalsPulseRange = (t: any) => sql`${t.pulse} IS NULL OR ${t.pulse} BETWEEN 25 AND 220`

/** vitals_resp_range */
export const vitalsRespRange = (t: any) => sql`${t.respirations} IS NULL OR ${t.respirations} BETWEEN 4 AND 70`

/** vitals_o2_range */
export const vitalsO2Range = (t: any) => sql`${t.oxygenSaturation} IS NULL OR ${t.oxygenSaturation} BETWEEN 50 AND 100`

/** vitals_temp_range */
export const vitalsTempRange = (t: any) => sql`${t.temperatureF} IS NULL OR ${t.temperatureF} BETWEEN 85.0 AND 112.0`

/** vitals_glucose_range */
export const vitalsGlucoseRange = (t: any) => sql`${t.bloodGlucose} IS NULL OR ${t.bloodGlucose} BETWEEN 20 AND 800`

/** vitals_weight_range */
export const vitalsWeightRange = (t: any) => sql`${t.weightLbs} IS NULL OR ${t.weightLbs} BETWEEN 30 AND 800`

/** vitals_pain_range */
export const vitalsPainRange = (t: any) => sql`${t.painScale} IS NULL OR ${t.painScale} BETWEEN 0 AND 10`

/** documents_entity_type_check */
export const documentsEntityTypeCheck = (t: any) => sql`${t.entityType} IN ('client','caregiver','company')`

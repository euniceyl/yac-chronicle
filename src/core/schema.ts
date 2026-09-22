/**
 * PCX column names
 */

export interface TableSpec {
  id: string;
  file: string;
  fields: Record<string, string[]>;
  required: string[];
}

const PATIENT_ID = ['research_id', 'cbtn_cid', 'cid', 'patient_id', 'subject_id'];

export const TABLES: TableSpec[] = [
  {
    id: 'demographics',
    file: 'pcx_30_demographics_deid.csv',
    fields: {
      patientId: PATIENT_ID,
      organization: ['organization_name', 'site', 'institution'],
      birthYear: ['birth_date', 'year_of_birth', 'birth_year'],
      race: ['race'],
      ethnicity: ['ethnicity'],
      sex: ['gender', 'legal_sex', 'sex'],
      diagnosisCohort: ['diagnosis_type_cohort', 'diagnosis_cohort'],
      dataCohort: ['data_type_cohort', 'data_cohort'],
    },
    required: ['patientId'],
  },
  {
    id: 'event',
    file: 'pcx_30_event_level_deid.csv',
    fields: {
      patientId: PATIENT_ID,
      organization: ['organization_name'],
      eventType: ['event_type'],
      eventDay: ['event_date', 'age_at_event_days', 'event_age_days'],
      diagnosisCategory: ['cns_diagnosis_category'],
      integratedDiagnosis: ['cns_integrated_diagnosis'],
      tumorLocations: ['tumor_locations'],
      tumorLocationOther: ['tumor_location_other'],
      metastasis: ['metastasis'],
      metastasisLocation: ['metastasis_location'],
      metastasisLocationOther: ['metastasis_location_other'],
      medicalConditions: ['medical_conditions_present_at_event'],
      // expected in a future drop
      changMStage: ['chang_mstage', 'chang_m_stage'],
      stagingMethod: ['staging_evaluation_method'],
    },
    required: ['patientId', 'eventType', 'eventDay'],
  },
  {
    id: 'surgery',
    file: 'pcx_30_surgery_level_deid.csv',
    fields: {
      patientId: PATIENT_ID,
      organization: ['organization_name'],
      surgeryDay: ['surgery_date', 'age_at_surgery_days'],
      extentOfResection: ['extent_of_tumor_resection', 'extent_of_resection'],
      // expected in a future drop
      surgeryType: ['surgery_type'],
    },
    required: ['patientId', 'surgeryDay'],
  },
  {
    id: 'medicalTherapy',
    file: 'pcx_30_medical_therapy_level_deid.csv',
    fields: {
      patientId: PATIENT_ID,
      organization: ['organization_name'],
      protocol: ['protocol_name_and_arm', 'protocol_name'],
      therapyType: ['chemotherapy_type', 'medical_therapy_type'],
      startDay: ['regimen_start_date', 'age_at_regimen_start_days'],
      stopDay: ['regimen_stop_date', 'age_at_regimen_stop_days'],
      agents: ['chemotherapy_agents', 'therapeutic_agents', 'agents'],
    },
    required: ['patientId', 'startDay'],
  },
  {
    id: 'radiation',
    file: 'pcx_30_radiation_level_deid.csv',
    fields: {
      patientId: PATIENT_ID,
      organization: ['organization_name'],
      startDay: ['radiation_start_date', 'age_at_radiation_start_days'],
      stopDay: ['radiation_stop_date', 'age_at_radiation_stop_days'],
      site: ['radiation_site'],
      siteOther: ['radiation_site_other'],
      type: ['radiation_type'],
      typeOther: ['radiation_type_other'],
      totalDose: ['total_radiation_dose'],
      totalDoseUnit: ['total_radiation_dose_unit'],
      focalDose: ['total_radiation_dose_focal'],
      focalDoseUnit: ['total_radiation_dose_focal_unit'],
      // expected in a future drop
      anatomicSite: ['anatomic_site', 'anatomic_sites'],
    },
    required: ['patientId', 'startDay'],
  },
  {
    id: 'patientLevel',
    file: 'pcx_30_patient_level_deid.csv',
    fields: {
      patientId: PATIENT_ID,
      vitalStatus: ['vital_status'],
      vitalStatusDay: ['vital_status_date', 'age_at_last_known_status_days'],
      // expected in a future drop
      earliestMriDay: ['earliest_tumor_mri_date', 'age_at_earliest_tumor_mri_days'],
      cancerPredisposition: ['cancer_predispositions', 'cancer_predisposition'],
    },
    required: ['patientId'],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** match logical fields to CSV headers */
export function resolveColumns(
  headers: string[],
  spec: TableSpec,
): { map: Record<string, string | null>; missingRequired: string[] } {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const map: Record<string, string | null> = {};
  for (const [logical, candidates] of Object.entries(spec.fields)) {
    map[logical] = candidates.map((c) => byNorm.get(norm(c))).find(Boolean) ?? null;
  }
  const missingRequired = spec.required.filter((f) => !map[f]);
  return { map, missingRequired };
}

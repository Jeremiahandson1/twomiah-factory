// Home care's starter libraries: the six care plan templates and the built-in forms (the In-Home Client Assessment and
// the rest). Moved from templates/crm-homecare/backend/db/migrations/0017_care.sql, which seeded them once into the
// one agency's database. Here every company gets its own copy, written the first time its library is read
// (clients/carePlanTemplates.ts, clients/forms.ts), because a template row belongs to a company (company_id).
// Generated from the template's SQL VALUES, word for word.

export const BUILT_IN_CARE_PLAN_TEMPLATES = [
  {
    "templateName": "Personal Care — Independent Adult",
    "templateDescription": "Bathing, grooming, dressing assistance for a mostly-independent client.",
    "category": "personal_care",
    "serviceType": "personal_care",
    "frequency": "Weekly visits",
    "careGoals": "Maintain personal hygiene and grooming\nPromote dignity and independence\nMonitor skin integrity",
    "specialInstructions": "Allow client to perform tasks they can manage independently — supervise only.\nOffer choices (e.g., shower vs. bath, time of day) to preserve autonomy.",
    "precautions": "Watch for skin breakdown around bony prominences.\nReport any falls, bruising, or skin changes.",
    "medicationNotes": "Refer to medication list. Caregiver may remind but not administer unless trained and authorized.",
    "mobilityNotes": "Ambulatory. Stand-by assistance only — no transfer required unless noted.",
    "dietaryNotes": "Regular diet. Encourage hydration (8 cups water/day).",
    "communicationNotes": "Speak clearly, face client. No known communication barriers."
  },
  {
    "templateName": "Dementia / Alzheimer's Care",
    "templateDescription": "For clients with moderate cognitive decline. Focus on routine, safety, validation.",
    "category": "dementia_care",
    "serviceType": "personal_care",
    "frequency": "Daily visits, same caregiver preferred",
    "careGoals": "Maintain consistent daily routine\nMinimize agitation and confusion\nEnsure home safety (no wandering, no falls)\nProvide cognitive engagement",
    "specialInstructions": "Same caregiver visits each day if possible — continuity reduces anxiety.\nUse validation therapy, not correction. Do not argue about misremembered facts.\nRedirect rather than refuse.\nKeep environment calm: low noise, soft lighting in evening.\nFollow consistent meal/activity/bedtime schedule.",
    "precautions": "Wandering risk — verify all doors locked before leaving.\nFall risk — clear pathways, remove throw rugs.\nDo not leave client alone with stove on.\nReport any new agitation, paranoia, or refusal of care.",
    "medicationNotes": "Caregiver to remind only. Family/RN administers. Watch for medication refusal — common in dementia.",
    "mobilityNotes": "Stand-by to minimal assist. Gait may be unsteady — encourage cane/walker use.",
    "dietaryNotes": "Soft/easy-chew foods preferred if dental issues. Hydrate often — dementia clients often forget to drink.",
    "communicationNotes": "Speak slowly, one short sentence at a time. Use name. Make eye contact. Avoid open-ended questions; offer simple choices."
  },
  {
    "templateName": "Post-Surgical Recovery (Hip/Knee)",
    "templateDescription": "Short-term recovery support after orthopedic surgery.",
    "category": "post_surgical",
    "serviceType": "personal_care",
    "frequency": "Daily for first 2 weeks, then PRN",
    "careGoals": "Promote safe healing per surgeon's instructions\nPrevent falls and re-injury\nManage pain comfort\nAssist with prescribed PT exercises",
    "specialInstructions": "Follow weight-bearing restrictions exactly as ordered (TDWB / PWB / FWB).\nAssist with home exercise program — 2x/day at minimum.\nIce 15-20 min after PT exercises.\nElevate surgical leg when resting.",
    "precautions": "Watch surgical incision for redness, drainage, swelling — report to RN immediately.\nDVT/PE warning signs: calf pain/swelling, sudden shortness of breath — 911.\nDo NOT bend hip past 90°, cross legs, or twist (hip clients).",
    "medicationNotes": "Pain meds usually scheduled. Anticoagulant (e.g., Lovenox, Eliquis) common — watch for bruising/bleeding.",
    "mobilityNotes": "Use walker for all transfers. Caregiver provides stand-by assist. No bending below knee level (hip restrictions).",
    "dietaryNotes": "Regular diet. Encourage protein for tissue repair. Hydrate well — anesthesia + opioids cause constipation.",
    "communicationNotes": "Alert and oriented. Communicate any new pain, fever, or changes promptly."
  },
  {
    "templateName": "Companion Care",
    "templateDescription": "Social engagement, light housekeeping, errands. No personal care needs.",
    "category": "companion",
    "serviceType": "companionship",
    "frequency": "Flexible schedule",
    "careGoals": "Reduce isolation through social interaction\nMaintain a safe, clean home environment\nAssist with errands and appointments",
    "specialInstructions": "Activities client enjoys: reading aloud, cards, light walks, music, reminiscing.\nLight housekeeping: dishes, laundry, dusting, sweeping.\nMeal prep encouraged — eat together when possible.",
    "precautions": "No major safety concerns. Maintain situational awareness during community outings.",
    "medicationNotes": "Self-administered. Caregiver does not handle medications.",
    "mobilityNotes": "Independent. Stand-by during community outings.",
    "dietaryNotes": "Per client preference.",
    "communicationNotes": "Engaged conversationalist. Respect privacy on sensitive topics."
  },
  {
    "templateName": "Diabetes Management Support",
    "templateDescription": "For diabetic clients needing meal/medication reminders and blood-sugar monitoring.",
    "category": "chronic_condition",
    "serviceType": "personal_care",
    "frequency": "Daily visits, meal-time aligned",
    "careGoals": "Maintain stable blood glucose\nSupport diabetic diet adherence\nMonitor for signs of hypo/hyperglycemia\nFoot/skin daily check",
    "specialInstructions": "Remind client to check blood sugar per RN schedule.\nLog readings in care notes.\nDaily foot inspection — report any wound, redness, or sensation change immediately.\nEnsure client eats consistent carb portions at consistent times.",
    "precautions": "HYPOGLYCEMIA (BG < 70): glucose tabs/juice, recheck in 15 min, call RN if not resolved.\nHYPERGLYCEMIA (BG > 300, fruity breath, confusion): 911.\nAny foot wound that doesn't heal in 48h: notify RN.",
    "medicationNotes": "Insulin / oral hypoglycemics. Caregiver reminds; trained/authorized caregivers may administer per care plan.",
    "mobilityNotes": "Ambulatory. Avoid hot water for foot soaks (risk of burns with reduced sensation).",
    "dietaryNotes": "Diabetic / consistent-carb diet. Low sodium if also hypertensive. Limit concentrated sweets.",
    "communicationNotes": "Alert. Watch for confusion or sluggishness — could indicate blood-sugar swing."
  },
  {
    "templateName": "End of Life / Hospice Support",
    "templateDescription": "Comfort care for terminally ill clients. Comply with hospice plan of care.",
    "category": "hospice",
    "serviceType": "personal_care",
    "frequency": "Daily, hours per hospice order",
    "careGoals": "Maximize comfort and dignity\nSupport client and family emotionally\nFollow hospice plan of care exactly",
    "specialInstructions": "Hospice nurse is lead. Caregiver supports, does not direct.\nGentle repositioning q2h to prevent skin breakdown.\nMouth care every 2 hours — terminal dehydration causes dry mouth.\nFamily presence is comforting — do not interrupt unless asked.\nPlay favorite music, read aloud, hold hand. Hearing is the last sense to go.",
    "precautions": "Do NOT call 911 for expected death — call hospice nurse first.\nDo not force food/water — terminal anorexia is natural and not painful.\nAny pain or distress: notify hospice immediately.",
    "medicationNotes": "Comfort meds (morphine, lorazepam, atropine) per hospice. Administered by hospice/family. Caregiver may remind/assist per training.",
    "mobilityNotes": "Bed-bound likely. Two-person transfer if any. Use draw sheet to reposition.",
    "dietaryNotes": "Offer small sips/ice chips per tolerance. Do not pressure intake.",
    "communicationNotes": "May be non-verbal. Continue to speak to client. Identify self when entering room."
  }
]

/** A form with a state is offered only to an agency in that state (a state Medicaid form). */
export const BUILT_IN_FORM_TEMPLATES: { name: string; description: string; category: string; fields: any[]; requiresSignature: boolean; autoAttachTo: string | null; state: string | null }[] = [
  {
    "name": "Client Intake Form",
    "description": "Initial demographic + medical history captured at first contact.",
    "category": "intake",
    "fields": [
      {
        "id": "preferred_name",
        "label": "What name does the client prefer to go by?",
        "type": "text",
        "required": false
      },
      {
        "id": "primary_concern",
        "label": "Primary reason for requesting home care",
        "type": "textarea",
        "required": true
      },
      {
        "id": "diagnoses",
        "label": "Current diagnoses (comma-separated)",
        "type": "textarea",
        "required": false
      },
      {
        "id": "allergies",
        "label": "Allergies (food, medication, environmental)",
        "type": "textarea",
        "required": true
      },
      {
        "id": "current_meds",
        "label": "Current medications (name, dose, frequency)",
        "type": "textarea",
        "required": true
      },
      {
        "id": "mobility_status",
        "label": "Mobility status",
        "type": "radio",
        "required": true,
        "options": [
          "Fully ambulatory",
          "Walker / cane",
          "Wheelchair (transfers self)",
          "Wheelchair (needs transfer assist)",
          "Bed-bound"
        ]
      },
      {
        "id": "cognitive_status",
        "label": "Cognitive status",
        "type": "select",
        "required": true,
        "options": [
          "Alert and oriented x3",
          "Mild forgetfulness",
          "Moderate dementia",
          "Advanced dementia",
          "Non-verbal"
        ]
      },
      {
        "id": "fall_risk",
        "label": "Fall history in last 6 months?",
        "type": "radio",
        "required": true,
        "options": [
          "No falls",
          "1 fall",
          "2-3 falls",
          "More than 3 falls"
        ]
      },
      {
        "id": "primary_caregiver_family",
        "label": "Primary family caregiver (name + relationship)",
        "type": "text",
        "required": false
      },
      {
        "id": "advance_directive",
        "label": "Has an advance directive / POLST on file?",
        "type": "radio",
        "required": true,
        "options": [
          "Yes (copy provided)",
          "Yes (not provided)",
          "No",
          "Unknown"
        ]
      },
      {
        "id": "pets",
        "label": "Pets in the home?",
        "type": "text",
        "required": false
      },
      {
        "id": "smoking_in_home",
        "label": "Smoking in the home?",
        "type": "radio",
        "required": true,
        "options": [
          "No",
          "Yes - resident only",
          "Yes - visitors"
        ]
      },
      {
        "id": "weapons_in_home",
        "label": "Firearms in the home? (safety question)",
        "type": "radio",
        "required": true,
        "options": [
          "No",
          "Yes - secured",
          "Yes - unsecured"
        ]
      }
    ],
    "requiresSignature": false,
    "autoAttachTo": "client",
    "state": null
  },
  {
    "name": "HIPAA Authorization to Release Information",
    "description": "Required release for sharing PHI with named family members or other providers.",
    "category": "consent",
    "fields": [
      {
        "id": "auth_release_to_name",
        "label": "Authorize release of my health information to (name)",
        "type": "text",
        "required": true
      },
      {
        "id": "auth_release_to_relationship",
        "label": "Relationship to me",
        "type": "text",
        "required": true
      },
      {
        "id": "auth_release_to_phone",
        "label": "Phone number of authorized party",
        "type": "text",
        "required": true
      },
      {
        "id": "info_categories",
        "label": "Categories of information to release",
        "type": "checkbox",
        "required": true,
        "options": [
          "Visit schedule",
          "Care plan",
          "Medication list",
          "Vitals / observations",
          "Billing / invoices",
          "Incidents",
          "Discharge information"
        ]
      },
      {
        "id": "purpose",
        "label": "Purpose of disclosure",
        "type": "select",
        "required": true,
        "options": [
          "At my request",
          "Care coordination",
          "Family involvement",
          "Legal",
          "Other"
        ]
      },
      {
        "id": "expires_in",
        "label": "This authorization expires in",
        "type": "select",
        "required": true,
        "options": [
          "6 months",
          "1 year",
          "Until revoked",
          "Upon discharge"
        ]
      },
      {
        "id": "right_to_revoke",
        "label": "I understand I may revoke this authorization in writing at any time.",
        "type": "checkbox",
        "required": true,
        "options": [
          "I understand"
        ]
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "client",
    "state": null
  },
  {
    "name": "Service Agreement — Private Pay",
    "description": "Contract between agency and private-pay client specifying services, rate, and terms.",
    "category": "general",
    "fields": [
      {
        "id": "services_authorized",
        "label": "Services authorized",
        "type": "checkbox",
        "required": true,
        "options": [
          "Personal care (bathing, grooming)",
          "Mobility assistance",
          "Meal preparation",
          "Light housekeeping",
          "Errands / transportation",
          "Companionship",
          "Medication reminders",
          "Other (specify in notes)"
        ]
      },
      {
        "id": "hours_per_week",
        "label": "Anticipated hours per week",
        "type": "number",
        "required": true
      },
      {
        "id": "hourly_rate",
        "label": "Hourly rate ($)",
        "type": "number",
        "required": true
      },
      {
        "id": "billing_cycle",
        "label": "Billing cycle",
        "type": "select",
        "required": true,
        "options": [
          "Weekly",
          "Bi-weekly",
          "Monthly"
        ]
      },
      {
        "id": "payment_method",
        "label": "Preferred payment method",
        "type": "select",
        "required": true,
        "options": [
          "Check",
          "ACH / bank transfer",
          "Credit card",
          "Long-term care insurance"
        ]
      },
      {
        "id": "min_cancel_notice",
        "label": "Cancellation notice required",
        "type": "select",
        "required": true,
        "options": [
          "24 hours",
          "48 hours",
          "1 week",
          "No fee for any cancellation"
        ]
      },
      {
        "id": "late_fee",
        "label": "Late payment fee (% per month past 30 days)",
        "type": "number",
        "required": false
      },
      {
        "id": "agreement_acknowledgement",
        "label": "I have read and agree to the terms above.",
        "type": "checkbox",
        "required": true,
        "options": [
          "I agree"
        ]
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "client",
    "state": null
  },
  {
    "name": "Wisconsin Plan of Care (POC)",
    "description": "Plan of Care required for WI Medicaid personal care services. Replaces the MA-1A elements that apply.",
    "category": "physician_order",
    "fields": [
      {
        "id": "primary_diagnosis",
        "label": "Primary diagnosis (ICD-10)",
        "type": "text",
        "required": true
      },
      {
        "id": "secondary_diagnoses",
        "label": "Secondary diagnoses",
        "type": "textarea",
        "required": false
      },
      {
        "id": "functional_limitations",
        "label": "Functional limitations",
        "type": "checkbox",
        "required": true,
        "options": [
          "Ambulation",
          "Transfer",
          "Bathing",
          "Toileting",
          "Dressing",
          "Eating",
          "Meal prep",
          "Medication management",
          "Communication",
          "Cognition"
        ]
      },
      {
        "id": "adl_assist_level",
        "label": "Level of ADL assistance required",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision",
          "Limited assist",
          "Extensive assist",
          "Total dependence"
        ]
      },
      {
        "id": "skilled_nursing_needed",
        "label": "Skilled nursing needed?",
        "type": "radio",
        "required": true,
        "options": [
          "No",
          "Yes - intermittent",
          "Yes - daily"
        ]
      },
      {
        "id": "frequency_of_visits",
        "label": "Frequency of visits",
        "type": "text",
        "required": true
      },
      {
        "id": "duration_per_visit",
        "label": "Duration per visit (hours)",
        "type": "number",
        "required": true
      },
      {
        "id": "goals_short_term",
        "label": "Short-term goals (30-90 days)",
        "type": "textarea",
        "required": true
      },
      {
        "id": "goals_long_term",
        "label": "Long-term goals",
        "type": "textarea",
        "required": true
      },
      {
        "id": "discharge_criteria",
        "label": "Discharge criteria",
        "type": "textarea",
        "required": false
      },
      {
        "id": "physician_name",
        "label": "Ordering physician",
        "type": "text",
        "required": true
      },
      {
        "id": "physician_signature_date",
        "label": "Physician signature date",
        "type": "text",
        "required": true
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "client",
    "state": "WI"
  },
  {
    "name": "Medication Administration Authorization",
    "description": "Required when caregivers administer (not just remind) medications.",
    "category": "physician_order",
    "fields": [
      {
        "id": "client_consent",
        "label": "Client / legal rep authorizes agency caregivers to administer medications as listed in the current medication list.",
        "type": "checkbox",
        "required": true,
        "options": [
          "I authorize"
        ]
      },
      {
        "id": "administered_categories",
        "label": "Categories authorized for administration",
        "type": "checkbox",
        "required": true,
        "options": [
          "Oral medications",
          "Topical (creams, ointments)",
          "Eye drops",
          "Ear drops",
          "Nasal sprays",
          "Insulin (per RN training)",
          "Inhalers / nebulizers",
          "Suppositories"
        ]
      },
      {
        "id": "training_verified",
        "label": "Caregiver has documented medication training",
        "type": "checkbox",
        "required": true,
        "options": [
          "Verified by RN",
          "Verified by agency director",
          "Pending — admin only until verified"
        ]
      },
      {
        "id": "controlled_substances",
        "label": "Are controlled substances involved?",
        "type": "radio",
        "required": true,
        "options": [
          "No",
          "Yes - witnessed administration required"
        ]
      },
      {
        "id": "errors_protocol",
        "label": "Caregiver acknowledges medication-error reporting protocol (notify supervisor immediately).",
        "type": "checkbox",
        "required": true,
        "options": [
          "Acknowledged"
        ]
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "client",
    "state": null
  },
  {
    "name": "Emergency Contact Information",
    "description": "Primary + backup contacts for incidents, hospital admissions, schedule changes.",
    "category": "intake",
    "fields": [
      {
        "id": "ec1_name",
        "label": "Primary contact — name",
        "type": "text",
        "required": true
      },
      {
        "id": "ec1_relationship",
        "label": "Primary contact — relationship",
        "type": "text",
        "required": true
      },
      {
        "id": "ec1_phone",
        "label": "Primary contact — phone (cell preferred)",
        "type": "text",
        "required": true
      },
      {
        "id": "ec1_can_decide",
        "label": "Primary contact authorized to make care decisions?",
        "type": "radio",
        "required": true,
        "options": [
          "Yes - durable POA",
          "Yes - informally",
          "No"
        ]
      },
      {
        "id": "ec2_name",
        "label": "Secondary contact — name",
        "type": "text",
        "required": false
      },
      {
        "id": "ec2_relationship",
        "label": "Secondary contact — relationship",
        "type": "text",
        "required": false
      },
      {
        "id": "ec2_phone",
        "label": "Secondary contact — phone",
        "type": "text",
        "required": false
      },
      {
        "id": "preferred_hospital",
        "label": "Preferred hospital",
        "type": "text",
        "required": false
      },
      {
        "id": "dnr_on_file",
        "label": "Do Not Resuscitate order on file?",
        "type": "radio",
        "required": true,
        "options": [
          "No",
          "Yes (POLST/MOLST attached)",
          "Yes (verbal only)"
        ]
      }
    ],
    "requiresSignature": false,
    "autoAttachTo": "client",
    "state": null
  },
  {
    "name": "Caregiver Employment Agreement",
    "description": "At-hire agreement covering scope, confidentiality, pay, conduct, termination.",
    "category": "hr",
    "fields": [
      {
        "id": "position",
        "label": "Position",
        "type": "select",
        "required": true,
        "options": [
          "Personal Care Worker",
          "Home Health Aide",
          "Companion",
          "CNA",
          "RN",
          "LPN"
        ]
      },
      {
        "id": "start_date",
        "label": "Start date",
        "type": "text",
        "required": true
      },
      {
        "id": "hourly_rate",
        "label": "Hourly rate ($)",
        "type": "number",
        "required": true
      },
      {
        "id": "weekly_hours",
        "label": "Expected weekly hours",
        "type": "number",
        "required": true
      },
      {
        "id": "employment_type",
        "label": "Employment classification",
        "type": "select",
        "required": true,
        "options": [
          "W-2 employee",
          "1099 contractor"
        ]
      },
      {
        "id": "confidentiality",
        "label": "Confidentiality / HIPAA acknowledgment",
        "type": "checkbox",
        "required": true,
        "options": [
          "I will keep all client PHI confidential and follow HIPAA + agency privacy policies."
        ]
      },
      {
        "id": "boundaries",
        "label": "Professional boundaries acknowledgment",
        "type": "checkbox",
        "required": true,
        "options": [
          "No personal financial transactions with clients, no gifts > $25, no posting client info on social media."
        ]
      },
      {
        "id": "at_will",
        "label": "I understand employment is at-will and either party may terminate the relationship with notice per policy.",
        "type": "checkbox",
        "required": true,
        "options": [
          "I understand"
        ]
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "caregiver",
    "state": null
  },
  {
    "name": "Photo / Media Release",
    "description": "Optional consent for using client photo on agency marketing materials.",
    "category": "consent",
    "fields": [
      {
        "id": "use_in_marketing",
        "label": "I grant the agency permission to use my photograph / likeness in",
        "type": "checkbox",
        "required": false,
        "options": [
          "Agency website",
          "Print brochures",
          "Social media (Facebook, etc.)",
          "Training materials (internal only)"
        ]
      },
      {
        "id": "no_identification",
        "label": "My name should not be displayed with my photo.",
        "type": "checkbox",
        "required": false,
        "options": [
          "Anonymous use only"
        ]
      },
      {
        "id": "right_to_revoke",
        "label": "I understand I may revoke this release in writing at any time. Already-printed materials are not recallable.",
        "type": "checkbox",
        "required": true,
        "options": [
          "I understand"
        ]
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "client",
    "state": null
  },
  {
    "name": "In-Home Client Assessment",
    "description": "Completed in the client's home at start of care, at each periodic review, and after any change in condition or hospital stay.",
    "category": "assessment",
    "fields": [
      {
        "id": "sec_visit",
        "type": "section",
        "label": "Assessment Visit"
      },
      {
        "id": "assessment_type",
        "label": "Type of assessment",
        "type": "radio",
        "required": true,
        "options": [
          "Initial (start of care)",
          "Periodic review",
          "Change in condition",
          "After hospital / rehab stay"
        ]
      },
      {
        "id": "assessment_date",
        "label": "Assessment date",
        "type": "date",
        "required": true
      },
      {
        "id": "present",
        "label": "Who was present (name + relationship)",
        "type": "text",
        "required": false
      },
      {
        "id": "payer",
        "label": "Payer",
        "type": "select",
        "required": false,
        "options": [
          "Private pay",
          "Medicaid / managed care (MCO)",
          "Self-directed program",
          "VA",
          "Long-term care insurance",
          "Other"
        ]
      },
      {
        "id": "sec_health",
        "type": "section",
        "label": "Health"
      },
      {
        "id": "diagnoses",
        "label": "Diagnoses",
        "type": "textarea",
        "required": false
      },
      {
        "id": "allergies",
        "label": "Allergies (medication, food, environmental) - write NKA if none",
        "type": "textarea",
        "required": true
      },
      {
        "id": "medications",
        "label": "Current medications (name, dose, how often)",
        "type": "textarea",
        "required": false
      },
      {
        "id": "med_management",
        "label": "Medication management",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Needs reminders",
          "Needs set-up (pill box filled by family / nurse)",
          "Managed entirely by others"
        ]
      },
      {
        "id": "physician",
        "label": "Primary physician (name + phone)",
        "type": "text",
        "required": false
      },
      {
        "id": "hospitalization",
        "label": "Hospital or ER visit recently?",
        "type": "radio",
        "required": false,
        "options": [
          "None in 6 months",
          "Within last 30 days",
          "Within last 6 months"
        ]
      },
      {
        "id": "hospitalization_notes",
        "label": "Hospital / ER details",
        "type": "textarea",
        "required": false
      },
      {
        "id": "sec_senses",
        "type": "section",
        "label": "Vision, Hearing, Communication"
      },
      {
        "id": "vision",
        "label": "Vision",
        "type": "radio",
        "required": false,
        "options": [
          "Adequate",
          "Impaired - uses glasses",
          "Severely impaired / blind"
        ]
      },
      {
        "id": "hearing",
        "label": "Hearing",
        "type": "radio",
        "required": false,
        "options": [
          "Adequate",
          "Hard of hearing",
          "Uses hearing aids",
          "Deaf"
        ]
      },
      {
        "id": "communication",
        "label": "Communication",
        "type": "radio",
        "required": false,
        "options": [
          "Speaks clearly",
          "Some difficulty",
          "Non-verbal"
        ]
      },
      {
        "id": "language",
        "label": "Primary language (if not English)",
        "type": "text",
        "required": false
      },
      {
        "id": "sec_cognition",
        "type": "section",
        "label": "Memory, Mood, Behavior"
      },
      {
        "id": "cognition",
        "label": "Memory / orientation",
        "type": "radio",
        "required": true,
        "options": [
          "Alert and oriented",
          "Mild forgetfulness",
          "Moderate impairment",
          "Severe impairment"
        ]
      },
      {
        "id": "dementia_dx",
        "label": "Diagnosed dementia or Alzheimer's?",
        "type": "radio",
        "required": false,
        "options": [
          "No",
          "Yes",
          "Suspected, not diagnosed"
        ]
      },
      {
        "id": "behaviors",
        "label": "Behaviors seen or reported",
        "type": "checkbox",
        "required": false,
        "options": [
          "None",
          "Wandering",
          "Agitation",
          "Verbal aggression",
          "Physical aggression",
          "Resists care",
          "Sundowning",
          "Hallucinations",
          "Depression / withdrawal",
          "Anxiety"
        ]
      },
      {
        "id": "safe_alone",
        "label": "Safe to be left alone?",
        "type": "radio",
        "required": true,
        "options": [
          "Yes",
          "Short periods only",
          "No - needs supervision"
        ]
      },
      {
        "id": "sec_adl",
        "type": "section",
        "label": "Activities of Daily Living (ADLs)"
      },
      {
        "id": "adl_bathing",
        "label": "Bathing",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "adl_dressing",
        "label": "Dressing",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "adl_grooming",
        "label": "Grooming / oral care",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "adl_toileting",
        "label": "Toileting",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "adl_continence",
        "label": "Continence",
        "type": "radio",
        "required": true,
        "options": [
          "Continent",
          "Occasional accidents",
          "Incontinent - bladder",
          "Incontinent - bladder and bowel",
          "Catheter / ostomy"
        ]
      },
      {
        "id": "adl_transfers",
        "label": "Transfers (bed, chair, toilet)",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "adl_mobility",
        "label": "Walking / getting around",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "adl_eating",
        "label": "Eating",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Supervision / cueing",
          "Some hands-on help",
          "Total help",
          "N/A"
        ]
      },
      {
        "id": "equipment",
        "label": "Equipment in use",
        "type": "checkbox",
        "required": false,
        "options": [
          "None",
          "Cane",
          "Walker",
          "Wheelchair",
          "Hoyer lift",
          "Gait belt",
          "Grab bars",
          "Shower chair / tub bench",
          "Raised toilet seat",
          "Commode",
          "Hospital bed",
          "Oxygen"
        ]
      },
      {
        "id": "adl_notes",
        "label": "ADL notes (how the client likes things done)",
        "type": "textarea",
        "required": false
      },
      {
        "id": "sec_iadl",
        "type": "section",
        "label": "Household Tasks (IADLs)"
      },
      {
        "id": "iadl_meals",
        "label": "Meal preparation",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Needs some help",
          "Unable - needs it done",
          "Done by family"
        ]
      },
      {
        "id": "iadl_housekeeping",
        "label": "Housekeeping",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Needs some help",
          "Unable - needs it done",
          "Done by family"
        ]
      },
      {
        "id": "iadl_laundry",
        "label": "Laundry",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Needs some help",
          "Unable - needs it done",
          "Done by family"
        ]
      },
      {
        "id": "iadl_shopping",
        "label": "Shopping / errands",
        "type": "radio",
        "required": true,
        "options": [
          "Independent",
          "Needs some help",
          "Unable - needs it done",
          "Done by family"
        ]
      },
      {
        "id": "iadl_transport",
        "label": "Transportation",
        "type": "radio",
        "required": false,
        "options": [
          "Drives self",
          "Needs rides",
          "Unable to leave home",
          "Done by family"
        ]
      },
      {
        "id": "iadl_phone",
        "label": "Using the phone",
        "type": "radio",
        "required": false,
        "options": [
          "Independent",
          "Needs some help",
          "Unable"
        ]
      },
      {
        "id": "iadl_finances",
        "label": "Managing money / bills",
        "type": "radio",
        "required": false,
        "options": [
          "Independent",
          "Needs some help",
          "Handled by family / POA"
        ]
      },
      {
        "id": "sec_falls",
        "type": "section",
        "label": "Fall Risk"
      },
      {
        "id": "falls_6mo",
        "label": "Falls in the last 6 months",
        "type": "radio",
        "required": true,
        "options": [
          "None",
          "1",
          "2-3",
          "More than 3"
        ]
      },
      {
        "id": "fall_factors",
        "label": "Fall risk factors",
        "type": "checkbox",
        "required": false,
        "options": [
          "None",
          "Unsteady gait",
          "Dizziness",
          "Fear of falling",
          "Uses walker / cane inconsistently",
          "Night-time toileting",
          "Poor vision",
          "Medications that cause drowsiness"
        ]
      },
      {
        "id": "fall_risk",
        "label": "Overall fall risk",
        "type": "radio",
        "required": true,
        "options": [
          "Low",
          "Moderate",
          "High"
        ]
      },
      {
        "id": "sec_skin",
        "type": "section",
        "label": "Skin and Nutrition"
      },
      {
        "id": "skin",
        "label": "Skin condition",
        "type": "radio",
        "required": false,
        "options": [
          "Intact",
          "Fragile / bruises easily",
          "Open area or pressure sore - nurse notified"
        ]
      },
      {
        "id": "diet",
        "label": "Diet",
        "type": "checkbox",
        "required": false,
        "options": [
          "Regular",
          "Diabetic",
          "Low sodium",
          "Soft / pureed",
          "Thickened liquids",
          "Tube feeding",
          "Other (see notes)"
        ]
      },
      {
        "id": "swallowing",
        "label": "Trouble chewing or swallowing?",
        "type": "radio",
        "required": false,
        "options": [
          "No",
          "Yes"
        ]
      },
      {
        "id": "appetite",
        "label": "Appetite / weight change",
        "type": "radio",
        "required": false,
        "options": [
          "Good, stable",
          "Poor appetite",
          "Recent weight loss",
          "Recent weight gain"
        ]
      },
      {
        "id": "sec_home",
        "type": "section",
        "label": "Home Safety"
      },
      {
        "id": "living",
        "label": "Lives",
        "type": "radio",
        "required": true,
        "options": [
          "Alone",
          "With spouse / partner",
          "With family",
          "Other"
        ]
      },
      {
        "id": "home_hazards",
        "label": "Hazards found",
        "type": "checkbox",
        "required": false,
        "options": [
          "None",
          "Throw rugs",
          "Clutter in walkways",
          "Poor lighting",
          "Stairs without railing",
          "No grab bars in bathroom",
          "Pets underfoot",
          "Smoking in home",
          "Oxygen in use",
          "Firearms (unsecured)",
          "Hoarding",
          "Pests / sanitation"
        ]
      },
      {
        "id": "smoke_detectors",
        "label": "Working smoke detectors?",
        "type": "radio",
        "required": false,
        "options": [
          "Yes",
          "No",
          "Not checked"
        ]
      },
      {
        "id": "emergency_pendant",
        "label": "Medical alert / emergency pendant?",
        "type": "radio",
        "required": false,
        "options": [
          "Yes",
          "No"
        ]
      },
      {
        "id": "entry",
        "label": "How caregivers get in (key, lockbox code location, door)",
        "type": "text",
        "required": false
      },
      {
        "id": "pets",
        "label": "Pets",
        "type": "text",
        "required": false
      },
      {
        "id": "sec_support",
        "type": "section",
        "label": "Support and Wishes"
      },
      {
        "id": "family_contact",
        "label": "Main family contact (name, relationship, phone)",
        "type": "text",
        "required": false
      },
      {
        "id": "poa",
        "label": "Power of attorney / guardian (name, phone)",
        "type": "text",
        "required": false
      },
      {
        "id": "advance_directive",
        "label": "Advance directive / POLST",
        "type": "radio",
        "required": false,
        "options": [
          "Yes - copy on file",
          "Yes - no copy yet",
          "No",
          "Unknown"
        ]
      },
      {
        "id": "code_status",
        "label": "Code status",
        "type": "radio",
        "required": false,
        "options": [
          "Full code",
          "DNR",
          "Unknown"
        ]
      },
      {
        "id": "sec_plan",
        "type": "section",
        "label": "Recommended Services"
      },
      {
        "id": "services",
        "label": "Services recommended",
        "type": "checkbox",
        "required": true,
        "options": [
          "Personal care",
          "Bathing",
          "Medication reminders",
          "Meal preparation",
          "Light housekeeping",
          "Laundry",
          "Errands / shopping",
          "Transportation",
          "Companionship",
          "Respite",
          "Overnight"
        ]
      },
      {
        "id": "hours_per_week",
        "label": "Recommended hours per week",
        "type": "number",
        "required": false
      },
      {
        "id": "visit_schedule",
        "label": "Preferred days and times",
        "type": "text",
        "required": false
      },
      {
        "id": "client_goals",
        "label": "Client / family goals",
        "type": "textarea",
        "required": false
      },
      {
        "id": "caregiver_prefs",
        "label": "Caregiver preferences (gender, allergies to pets, non-smoker, etc.)",
        "type": "textarea",
        "required": false
      },
      {
        "id": "referrals",
        "label": "Referrals or follow-up needed (nurse, PT, social worker, equipment)",
        "type": "textarea",
        "required": false
      },
      {
        "id": "next_review",
        "label": "Next reassessment date",
        "type": "date",
        "required": false
      },
      {
        "id": "assessor",
        "label": "Completed by (name and title)",
        "type": "text",
        "required": true
      }
    ],
    "requiresSignature": true,
    "autoAttachTo": "client",
    "state": null
  }
]

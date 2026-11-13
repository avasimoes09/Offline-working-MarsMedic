import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISEASE_DATASET_DISEASE_COUNT,
  DISEASE_DATASET_FEATURES,
  DISEASE_DATASET_ROW_COUNT,
  capitalizeSymptom,
  filterSymptomsByQuery,
  getAdditionalSymptomsBySystem,
  getDatasetFeatureIndexes,
  getDiseaseDatasetMatches,
  getSymptomsBySubcategory,
} from './diseaseDataset.js';
import { getWellnessContext, runDiagnosis } from './diagnosisEngine.js';
import { getRelevantInventorySupport } from './inventoryGuidance.js';
import { BODY_SYSTEMS, SYMPTOMS } from './missionData.js';

test('loads the compact offline dataset and ranks symptoms without claiming probabilities', () => {
  assert.equal(DISEASE_DATASET_ROW_COUNT, 246945);
  assert.equal(DISEASE_DATASET_DISEASE_COUNT, 773);
  assert.equal(DISEASE_DATASET_FEATURES.length, 377);

  const matches = getDiseaseDatasetMatches(['fever'], 5);
  assert.equal(matches.length, 5);
  assert.ok(matches.every(({ score, samples, matched }) => (
    Number.isInteger(score) && score >= 0 && score <= 100 && samples >= 30 && matched.length > 0
  )));
});

test('maps existing and expanded symptom choices into one deduplicated feature set', () => {
  assert.deepEqual(
    getDatasetFeatureIndexes(['chest_pain', 'dataset:sharp chest pain', 'dataset:fever']),
    [
      DISEASE_DATASET_FEATURES.indexOf('sharp chest pain'),
      DISEASE_DATASET_FEATURES.indexOf('burning chest pain'),
      DISEASE_DATASET_FEATURES.indexOf('fever'),
    ],
  );
});

test('makes every expanded dataset symptom selectable under an existing body-system category', () => {
  const grouped = getAdditionalSymptomsBySystem();
  const symptoms = Object.entries(grouped).flatMap(([system, labels]) => labels.map((label) => ({ system, label })));
  const existing = new Set(DISEASE_DATASET_FEATURES.map((label) => label.toLocaleLowerCase()));

  assert.ok(symptoms.length > 0);
  assert.ok(symptoms.every(({ system, label }) => system && existing.has(label.toLocaleLowerCase())));
  assert.equal(new Set(symptoms.map(({ label }) => label)).size, symptoms.length);
});

test('omits pediatric-only choices and combines clear symptom duplicates', () => {
  const selectable = Object.values(getAdditionalSymptomsBySystem()).flat();
  const selectedLabels = new Set(selectable.map((label) => label.toLocaleLowerCase()));
  const pediatricOnly = /\b(?:infants?|bab(?:y|ies)|newborns?|neonat(?:al|e)|toddlers?|children?|pediatric|paediatric|teething|fontanel|breast milk|formula feeding)\b/i;

  assert.ok(selectable.every((label) => !pediatricOnly.test(label)));
  assert.equal(selectedLabels.has('diaper rash'), false);
  assert.equal(selectedLabels.has('low back pain'), false);
  assert.equal(selectedLabels.has('difficulty breathing'), false);
  assert.equal(selectedLabels.has('regurgitation.1'), false);
  assert.deepEqual(
    getDatasetFeatureIndexes(['chest_pain']),
    [DISEASE_DATASET_FEATURES.indexOf('sharp chest pain'), DISEASE_DATASET_FEATURES.indexOf('burning chest pain')],
  );
  assert.deepEqual(
    getDatasetFeatureIndexes(['dataset:back cramps or spasms']),
    [
      DISEASE_DATASET_FEATURES.indexOf('back cramps or spasms'),
      DISEASE_DATASET_FEATURES.indexOf('low back cramps or spasms'),
    ].sort((a, b) => a - b),
  );
});

test('groups every original and expanded symptom exactly once in subcategories', () => {
  const additional = getAdditionalSymptomsBySystem();
  for (const { id: systemId } of BODY_SYSTEMS) {
    const symptoms = [
      ...(SYMPTOMS[systemId] || []),
      ...(additional[systemId] || []).map((label) => ({ id: `dataset:${label}`, label })),
    ];
    const grouped = getSymptomsBySubcategory(systemId, symptoms);
    const groupedSymptoms = grouped.flatMap(({ symptoms: items }) => items);

    assert.deepEqual(groupedSymptoms.map(({ id }) => id).sort(), symptoms.map(({ id }) => id).sort());
    assert.equal(new Set(groupedSymptoms.map(({ id }) => id)).size, groupedSymptoms.length);
    assert.ok(grouped.every(({ label, symptoms: items }) => (
      !/\bother\b/i.test(label) && items.length > 1
    )), `${systemId} has no catch-all or single-item subcategories`);
    for (const { symptoms: items } of grouped) {
      assert.deepEqual(
        items.map(({ label }) => label),
        [...items.map(({ label }) => label)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      );
    }
  }
});

test('breaks general symptoms into specific categories without catch-all or single-item groups', () => {
  const symptoms = [
    ...SYMPTOMS.general,
    ...getAdditionalSymptomsBySystem().general.map((label) => ({ id: label, label })),
  ];
  const groups = getSymptomsBySubcategory('general', symptoms);
  const groupedLabels = groups.flatMap(({ symptoms: items }) => items.map(({ label }) => label));

  assert.ok(groups.length > 3);
  assert.ok(groups.every(({ label, symptoms: items }) => !/\bother\b/i.test(label) && items.length > 1));
  assert.ok(groupedLabels.includes('Fever'));
  assert.ok(groupedLabels.includes('Fatigue'));
});

test('does not offer pregnancy-specific symptoms', () => {
  const selectable = [
    ...Object.values(SYMPTOMS).flat().map(({ label }) => label),
    ...Object.values(getAdditionalSymptomsBySystem()).flat(),
  ];

  assert.ok(selectable.every((label) => !/\b(?:pregnan(?:t|cy)|antenatal|prenatal|gestational)\b/i.test(label)));
});

test('search filters symptoms by typed text and displays labels in title case', () => {
  const symptoms = [
    { id: 'one', label: 'shortness of breath' },
    { id: 'two', label: 'chest pain' },
  ];

  assert.deepEqual(filterSymptomsByQuery(symptoms, 'BREATH'), [symptoms[0]]);
  assert.deepEqual(filterSymptomsByQuery(symptoms, '  '), symptoms);
  assert.equal(capitalizeSymptom('shortness of breath'), 'Shortness Of Breath');
});

test('current vitals, recorded conditions, and wellness logs are included in assessment context', () => {
  const now = new Date();
  const logDate = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();
  const result = runDiagnosis(['fever', 'cough'], {}, {
    currentVitals: { temp: 39, spo2: 93, hr: 108, bpSys: 122, bpDia: 80, respiratoryRate: 24 },
    conditions: ['Pneumonia'],
    medications: 'Current medication list',
    events: [
      { type: 'Sleep', at: timestamp, details: JSON.stringify({ log_date: logDate, hours: 5.5 }) },
      { type: 'Nutrition', at: timestamp, details: JSON.stringify({ log_date: logDate, food_name: 'Electrolyte drink mix', amount: 1 }) },
    ],
    wellnessEntries: [{
      type: 'Nutrition',
      at: timestamp,
      details: { log_date: logDate, food_name: 'Oats', amount: 1 },
    }],
  });
  const pneumonia = result.results.find(({ id }) => id === 'pneumonia');

  assert.ok(pneumonia);
  assert.ok(pneumonia.historyFactors.some(({ label }) => label.includes('Pneumonia')));
  assert.ok(pneumonia.evidence.includes('Recorded vital: elevated temperature'));
  assert.equal(result.medicalHistory.currentVitals.oxygenSaturation, 93);
  assert.equal(result.wellness.averageSleepHours, 5.5);
  assert.deepEqual(result.wellness.recentFoods, ['Electrolyte drink mix', 'Oats']);
  assert.equal(result.wellness.nutrientAmountsAvailable, false);
  assert.equal(result.wellness.nutritionEntries, 2);
});

test('prior sleep and meal records are summarized from local session history', () => {
  const now = Date.UTC(2026, 0, 8, 12);
  const context = getWellnessContext([], [{
    entries: [
      { type: 'Sleep', at: '2026-01-07T08:00:00.000Z', details: '{"log_date":"2026-01-07","hours":7}' },
      { type: 'Sleep', at: '2026-01-08T08:00:00.000Z', details: '{"log_date":"2026-01-08","hours":6}' },
      { type: 'Nutrition', at: '2026-01-08T09:00:00.000Z', details: '{"log_date":"2026-01-08","food_name":"Oats"}' },
      { type: 'Sleep', at: '2025-12-01T08:00:00.000Z', details: '{"log_date":"2025-12-01","hours":3}' },
    ],
  }], now);

  assert.equal(context.sleepEntries, 2);
  assert.equal(context.averageSleepHours, 6.5);
  assert.equal(context.nutritionEntries, 1);
});

test('inventory matching only surfaces relevant, in-stock supportive supplies', () => {
  const support = getRelevantInventorySupport([
    { name: 'Oral rehydration salts', quantity: 3 },
    { name: 'Electrolyte solution', quantity: 0 },
    { name: 'Antibiotics', quantity: 12 },
  ], ['Vomiting', 'Diarrhea']);

  assert.deepEqual(support, [{ label: 'Hydration support', items: ['Oral rehydration salts'] }]);
});

test('treatment plans do not directly recommend medications from pattern matches', () => {
  const heartAttack = runDiagnosis(['chest_pain', 'shortness_of_breath', 'sweating']).results
    .find(({ id }) => id === 'heart_attack');

  assert.ok(heartAttack);
  assert.ok(heartAttack.treatment.some((step) => step.includes('onboard medical protocol')));
  assert.equal(heartAttack.treatment.some((step) => /aspirin 325 mg/i.test(step)), false);
});

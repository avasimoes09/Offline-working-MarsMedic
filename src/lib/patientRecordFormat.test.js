import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPatientHistoryEvent,
  getPatientWellnessEntries,
  summarizePatientAssessment,
  summarizePatientHistoryEvent,
  summarizePatientWellness,
} from './patientRecordFormat.js';

test('formats saved sleep and nutrition JSON as plain-language history', () => {
  assert.match(formatPatientHistoryEvent({
    type: 'Sleep',
    details: '{"log_date":"2026-11-09","sleep_time":"22:00","wake_time":"05:00","hours":7}',
  }), /Sleep on Nov 9, 2026: 7 hours, from 22:00 to 05:00\./);
  assert.match(formatPatientHistoryEvent({
    type: 'Nutrition',
    details: '{"log_date":"2026-11-09","food_name":"Oats","amount":1,"unit":"serving"}',
  }), /Food on Nov 9, 2026: 1 serving of Oats\./);
});

test('combines persisted wellness entries and session history without duplicating entries', () => {
  const patient = {
    wellnessEntries: [{
      id: 'sleep-1',
      type: 'Sleep',
      at: '2026-11-09T08:00:00.000Z',
      details: { log_date: '2026-11-09', hours: 7 },
    }],
    medicalHistoryEntries: [{
      entries: [
        { type: 'Sleep', at: '2026-11-09T08:00:00.000Z', details: '{"log_date":"2026-11-09","hours":7}' },
        { type: 'Nutrition', at: '2026-11-09T09:00:00.000Z', details: '{"log_date":"2026-11-09","food_name":"Oats","amount":1,"unit":"serving"}' },
      ],
    }],
  };
  const entries = getPatientWellnessEntries(patient);
  const summary = summarizePatientWellness(entries);

  assert.equal(entries.length, 2);
  assert.equal(summary.averageSleepHours, 7);
  assert.equal(summary.foodEntries, 1);
  assert.deepEqual(summary.recentFoods, ['Oats']);
});

test('summarizes assessment and energy history events without showing their details', () => {
  const assessment = {
    assessedAt: '2026-11-09T08:00:00.000Z',
    symptoms: ['Fever', 'Cough'],
    candidates: [{ id: 'pneumonia', name: 'Possible Pneumonia' }],
    selectedCandidateId: 'pneumonia',
  };
  assert.equal(
    summarizePatientAssessment(assessment),
    `${new Date(assessment.assessedAt).toLocaleString()} · Reviewed: Possible Pneumonia · 2 symptoms`,
  );
  assert.match(summarizePatientHistoryEvent({
    type: 'Sleep',
    at: '2026-11-09T08:00:00.000Z',
    details: { log_date: '2026-11-09', sleep_time: '22:00', wake_time: '05:00', hours: 7 },
  }), /^Sleep · Nov 9, 2026 · 7 h$/);
  assert.match(summarizePatientHistoryEvent({
    type: 'Nutrition',
    at: '2026-11-09T09:00:00.000Z',
    details: { log_date: '2026-11-09', food_name: 'Oats', amount: 1, unit: 'serving' },
  }), /^Food · Nov 9, 2026 · Oats · 1 serving$/);
});

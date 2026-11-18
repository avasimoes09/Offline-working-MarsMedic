function parseDetails(details) {
  if (details && typeof details === 'object' && !Array.isArray(details)) return details;
  if (typeof details !== 'string') return null;
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readableDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '';
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function amountText(amount, unit) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return '';
  return `${numericAmount} ${String(unit || 'serving')}`;
}

export function summarizePatientAssessment(assessment) {
  const assessedAt = new Date(assessment?.assessedAt);
  const date = Number.isNaN(assessedAt.getTime())
    ? 'Assessment date not recorded'
    : assessedAt.toLocaleString();
  const selected = assessment?.candidates?.find((candidate) => candidate.id === assessment.selectedCandidateId);
  const description = selected?.name ? `Reviewed: ${selected.name}` : 'Assessment';
  const symptomCount = Array.isArray(assessment?.symptoms) ? assessment.symptoms.length : 0;
  return `${date} · ${description} · ${symptomCount} ${symptomCount === 1 ? 'symptom' : 'symptoms'}`;
}

export function summarizePatientHistoryEvent(event) {
  const details = parseDetails(event?.details);
  const date = readableDate(details?.log_date) || readableDate(event?.at);
  if (event?.type === 'Sleep' && details) {
    const hours = Number(details.hours);
    return ['Sleep', date, Number.isFinite(hours) ? `${hours} h` : ''].filter(Boolean).join(' · ');
  }
  if (event?.type === 'Nutrition' && details) {
    return [
      'Food',
      date,
      String(details.food_name || ''),
      amountText(details.amount, details.unit),
    ].filter(Boolean).join(' · ');
  }
  return [String(event?.type || 'Clinical event'), date].filter(Boolean).join(' · ');
}

export function formatPatientHistoryEvent(event) {
  const details = parseDetails(event?.details);
  if (event?.type === 'Sleep' && details) {
    const date = readableDate(details.log_date);
    const time = details.sleep_time && details.wake_time
      ? `, from ${details.sleep_time} to ${details.wake_time}`
      : '';
    const hours = Number(details.hours);
    return `Sleep${date ? ` on ${date}` : ''}${Number.isFinite(hours) ? `: ${hours} hours` : ''}${time}.`;
  }
  if (event?.type === 'Nutrition' && details) {
    const date = readableDate(details.log_date);
    const food = String(details.food_name || 'Food entry');
    const amount = amountText(details.amount, details.unit);
    return `Food${date ? ` on ${date}` : ''}: ${amount ? `${amount} of ` : ''}${food}.`;
  }
  return typeof event?.details === 'string' ? event.details : '';
}

export function getPatientWellnessEntries(patient = {}) {
  const saved = Array.isArray(patient.wellnessEntries) ? patient.wellnessEntries : [];
  const fromSessions = (Array.isArray(patient.medicalHistoryEntries) ? patient.medicalHistoryEntries : [])
    .flatMap((session) => Array.isArray(session?.entries) ? session.entries : [])
    .filter((entry) => entry?.type === 'Sleep' || entry?.type === 'Nutrition');
  const entries = [...saved, ...fromSessions].map((entry, index) => ({
    ...entry,
    details: parseDetails(entry.details) || {},
    id: entry.id || `${entry.at || 'history'}-${entry.type}-${index}`,
  }));
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.type}:${entry.at || ''}:${JSON.stringify(entry.details)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

export function summarizePatientWellness(entries = []) {
  const sleep = entries
    .filter((entry) => entry.type === 'Sleep')
    .map((entry) => Number(entry.details?.hours))
    .filter((hours) => Number.isFinite(hours) && hours >= 0 && hours <= 24);
  const foods = entries
    .filter((entry) => entry.type === 'Nutrition' && entry.details?.food_name)
    .map((entry) => String(entry.details.food_name));
  return {
    sleepEntries: sleep.length,
    averageSleepHours: sleep.length
      ? Math.round((sleep.reduce((sum, hours) => sum + hours, 0) / sleep.length) * 10) / 10
      : null,
    foodEntries: foods.length,
    recentFoods: [...new Set(foods)].slice(0, 8),
  };
}

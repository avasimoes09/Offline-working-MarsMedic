import dataset from './diseaseSymptomData.json' with { type: 'json' };
import { BODY_SYSTEMS, SYMPTOMS } from './missionData.js';

export const DISEASE_DATASET_SOURCE = dataset.source;
export const DISEASE_DATASET_ROW_COUNT = dataset.rows;
export const DISEASE_DATASET_FEATURES = dataset.features;
export const DISEASE_DATASET_DISEASE_COUNT = dataset.diseases.length;
export const DATASET_SYMPTOM_PREFIX = 'dataset:';

const normalize = (value) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const capitalizeSymptom = (value) => value.replace(/\b[a-z]/g, (letter) => letter.toLocaleUpperCase());
const featureIndexes = new Map(dataset.features.map((feature, index) => [normalize(feature), index]));
const featureAliases = {
  'chest pain': ['sharp chest pain', 'burning chest pain'],
  'colored sputum': ['pus in sputum'],
  'low mood': ['depression'],
  'anxiety': ['anxiety and nervousness'],
  'abdominal pain': ['sharp abdominal pain', 'burning abdominal pain', 'lower abdominal pain', 'upper abdominal pain'],
  'flank pain': ['side pain'],
  'rash': ['abnormal appearing skin', 'skin lesion'],
  'rash in skin folds or under straps': ['diaper rash'],
  'shortness of breath': ['difficulty breathing'],
  'nasal congestion': ['sinus congestion'],
  'runny nose': ['coryza'],
  'back pain': ['low back pain'],
  'back stiffness or tightness': ['low back stiffness or tightness'],
  'back cramps or spasms': ['low back cramps or spasms'],
};

const symptomLabels = new Map();
Object.values(SYMPTOMS).flat().forEach(({ id, label }) => symptomLabels.set(id, label));
const existingLabels = new Set([...symptomLabels.values()].map(normalize));
const mergedFeatureAliases = new Set(Object.values(featureAliases).flat().map(normalize));
const pediatricOnlySymptom = /\b(?:infants?|bab(?:y|ies)|newborns?|neonat(?:al|e)|toddlers?|children?|pediatric|paediatric|teething|fontanel|breast milk|formula feeding)\b/i;
const bodySystemLabels = new Map(BODY_SYSTEMS.map(({ id, label }) => [id, label]));
const subcategoryRules = {
  cardiovascular: [
    ['Chest Pain And Pressure', /\b(?:chest pain|chest tightness|burning chest|heartburn)\b/],
    ['Heart Rhythm And Rate', /\b(?:heart|cardiac|palpitation|pulse|heartbeat|heart rate|fainting)\b/],
    ['Circulation And Swelling', /\b(?:circulation|blood pressure|swelling|edema|leg pain|clot)\b/],
  ],
  respiratory: [
    ['Breathing And Airway', /\b(?:breath|breathing|wheez|lung|apnea|respiratory|airway)\b/],
    ['Cough And Throat', /\b(?:cough|sputum|phlegm|throat|voice|hoarse|swallow)\b/],
    ['Nose And Sinuses', /\b(?:nose|nasal|sinus|sneeze|coryza|congestion|runny)\b/],
    ['Chest Symptoms', /\b(?:chest|rib|hurts to breath)\b/],
  ],
  neurological: [
    ['Headache And Balance', /\b(?:headache|dizz|faint|vertigo|motion|disorientation)\b/],
    ['Vision, Hearing, And Senses', /\b(?:vision|eye|ear|hearing|smell|taste|sensation|numb|tingling|paresthesia|blindness|cross.eyed|pupil)\b/],
    ['Movement And Strength', /\b(?:weakness|movement|paralysis|spasm|cramp|seizure|tremor|involuntary)\b/],
    ['Speech, Memory, And Awareness', /\b(?:speech|speaking|slurring|stutter|memory|confusion|disorientation|hallucination|delusion)\b/],
  ],
  gastrointestinal: [
    ['Stomach And Abdominal Symptoms', /\b(?:abdom|stomach|nausea|vomit|heartburn|regurgit|bloating|flatulence|liver|jaundice)\b/],
    ['Bowel And Stool Symptoms', /\b(?:diarr|stool|bowel|constipat|rectal|anus|melena|blood in stool)\b/],
    ['Eating And Appetite', /\b(?:appetite|eating|feeding|swallow|weight|thirst|food)\b/],
  ],
  skin: [
    ['Rashes And Irritation', /\b(?:skin|rash|itch|mole|acne|lesion|irritation|peel|scalp|ulcer|sore|burn|growth)\b/],
    ['Hair And Nails', /\b(?:hair|nail|scalp)\b/],
    ['Lips And Mouth', /\b(?:lip|mouth|tongue|gum|tooth|oral)\b/],
  ],
  urinary: [
    ['Urination And Bladder', /\b(?:urine|urination|bladder|kidney|prostate|hesitancy|incontinence)\b/],
    ['Reproductive And Genital Symptoms', /\b(?:testicle|scrotum|vaginal|menstru|menopause|uterine|pregnan|sexual|sex drive|ejaculat|infertility|penis|vulv|genital|impotence|breast|nipple|pelvic)\b/],
  ],
  musculoskeletal: [
    ['Back And Neck', /\b(?:back|neck|spine|posture|torso)\b/],
    ['Joint And Limb Pain', /\b(?:pain|joint|bone|hip|knee|shoulder|ankle|wrist|elbow|arm|leg|foot|toe)\b/],
    ['Stiffness, Swelling, And Movement', /\b(?:stiff|swelling|swollen|cramp|spasm|movement|weakness|tightness|contracture)\b/],
  ],
  mental: [
    ['Mood And Anxiety', /\b(?:anxiety|depress|mood|anger|irritable|self esteem|fear|phobia|stress)\b/],
    ['Sleep And Alertness', /\b(?:sleep|insomnia|sleepiness|nightmare|sleepwalking|apnea)\b/],
    ['Thinking And Behavior', /\b(?:behavior|hallucination|confusion|memory|obsession|compulsion|restless|alcohol|drug abuse|hostile)\b/],
  ],
  space: [
    ['Motion And Balance', /\b(?:dizz|nausea|vomit|sweat|disorientation|motion)\b/],
    ['Fluid Shift And Vision', /\b(?:puffy|swelling|vision|eye|fluid|face)\b/],
    ['Spaceflight-Related Discomfort', /\b(?:back|height|torso|stiff|muscle|joint|fatigue)\b/],
  ],
  general: [
    ['Temperature And Sweating', /\b(?:cold|hot|temperature|chill\w*|sweat\w*|flushing|hot flashes?)\b/],
    ['Fever And Infection', /\b(?:fever|infection|infected|flu|illness|ill)\b/],
    ['Energy And Sleep Changes', /\b(?:fatigue|weakness|sleepiness|sleepwalking|nightmares?|insomnia|apnea)\b/],
    ['Weight, Appetite, And Thirst', /\b(?:weight|appetite|underweight|overweight|eating|thirst|food)\b/],
    ['Headache, Dizziness, And Balance', /\b(?:headache|dizz\w*|vertigo|balance)\b/],
    ['Nausea And Stomach Symptoms', /\b(?:nausea|vomit\w*|stomach|abdom\w*|indigestion)\b/],
    ['Pain And Aches', /\b(?:pain|ache|toothache|cramps?|spasms?|soreness|painful)\b/],
    ['Bleeding And Discharge', /\b(?:bleed|blood|discharge|hemoptysis|melena)\b/],
    ['Swelling And Fluid Changes', /\b(?:swelling|swollen|edema|fluid|retention|lymphedema|puffy)\b/],
    ['Allergic Reactions', /\b(?:allerg|reaction|hives)\b/],
    ['Movement And Stiffness', /\b(?:movement|stiff|tightness|contracture|bowlegged|knock.kneed|turned in)\b/],
    ['Mood And Behavior', /\b(?:mood|depress|psychotic|emotional|temper|restless\w*|fear\w*|phobia\w*|obsession\w*|compulsion\w*|irritab|self.esteem|hostile)\b/],
    ['Skin, Hair, And Nail Changes', /\b(?:skin|rash|itch|peeling|scaliness|roughness|nail|wart\w*|pallor)\b/],
    ['Lumps And Body Shape Changes', /\b(?:mass|lump|shape|size|growth|appearing|symptoms of the face)\b/],
    ['General Changes', /\b(?:feeling|problems|symptoms)\b/],
  ],
};
const systemRules = [
  ['space', /\b(?:spaceflight|microgravity|motion sickness|puffy face|fluid shift|weightlessness)\b/],
  ['cardiovascular', /\b(?:heart\w*|cardiac|chest pain|palpitation|pulse|circulation|blood pressure|fainting|sweating)\b/],
  ['respiratory', /\b(?:breath\w*|cough\w*|sputum|lung|wheez\w*|throat|nose|sinus|sneez\w*|coryza|voice|congestion|chest tightness|phlegm|nosebleed|epistaxis)\b/],
  ['neurological', /\b(?:headache|dizz\w*|vision|eye|ear\w*|hearing|sensation|weakness|speech|slurr\w*|stutter\w*|memory|seizure\w*|confusion|paralysis|smell|taste|numb|tingling|paresthesia|blindness|cross.eyed|pupil\w*|involuntary movement\w*|lacrimation)\b/],
  ['gastrointestinal', /\b(?:abdom\w*|stomach|vomit\w*|nausea|diarr\w*|stool|bowel|constipat\w*|rectal|anus|appetite|swallow\w*|feeding|eating|regurgit\w*|heartburn|liver|jaundice|flatulence|melena|gums?|toothache|tongue|mouth|belly button)\b/],
  ['skin', /\b(?:skin|rash|itch|mole|nail|hair|lip|lesion|acne|growth|wound|burn|peel|scalp|ulcer|sore|wart|eyelid|dry lips|mouth dryness|tongue lesion)\b/],
  ['urinary', /\b(?:urine|urination|bladder|kidney|prostate|testicle|scrotum|vaginal|\w*menstru\w*|menopause|uterine|pregnan\w*|sexual|sex drive|ejaculat\w*|infertility|penis|vulv\w*|genital|impotence|breast|nipple|pelvic|bedwetting|hesitancy|polyuria)\b/],
  ['musculoskeletal', /\b(?:pain|stiff\w*|joint|bone|back|muscle|limb|cramp|spasm|swelling|swollen|movement|posture|hip|knee|shoulder|ankle|wrist|elbow|arm|leg|foot|toe|contractur\w*|bowlegged|knock.kneed|turned in)\b/],
  ['mental', /\b(?:anxiety|depress|mood|sleep|insomnia|anger|behavior|hallucination\w*|delusion\w*|fear\w*|phobia\w*|obsession\w*|compulsion\w*|alcohol|drug abuse|self esteem|restless\w*|irritable|temper|nailbiting|emotional|psychotic)\b/],
];
const totalRows = dataset.diseases.reduce((sum, [, samples]) => sum + samples, 0);
const globalCounts = new Map();
for (const [, , symptomCounts] of dataset.diseases) {
  for (const [featureIndex, count] of symptomCounts) {
    globalCounts.set(featureIndex, (globalCounts.get(featureIndex) || 0) + count);
  }
}

export function getDatasetFeatureIndexes(selectedSymptoms) {
  const indexes = new Set();
  for (const selected of selectedSymptoms) {
    if (selected.startsWith(DATASET_SYMPTOM_PREFIX)) {
      const featureName = selected.slice(DATASET_SYMPTOM_PREFIX.length);
      const normalized = normalize(featureName);
      const featureIndex = featureIndexes.get(normalized);
      if (featureIndex !== undefined) indexes.add(featureIndex);
      for (const alias of featureAliases[normalized] || []) {
        const aliasIndex = featureIndexes.get(normalize(alias));
        if (aliasIndex !== undefined) indexes.add(aliasIndex);
      }
      continue;
    }

    const label = symptomLabels.get(selected);
    if (!label) continue;
    const normalized = normalize(label);
    const exactIndex = featureIndexes.get(normalized);
    if (exactIndex !== undefined) indexes.add(exactIndex);
    for (const alias of featureAliases[normalized] || []) {
      const aliasIndex = featureIndexes.get(normalize(alias));
      if (aliasIndex !== undefined) indexes.add(aliasIndex);
    }
  }
  return [...indexes];
}

export function getSymptomsBySubcategory(systemId, symptoms = []) {
  const rules = subcategoryRules[systemId] || subcategoryRules.general;
  const grouped = new Map();
  const additional = [];
  for (const symptom of symptoms) {
    const category = rules.find(([, pattern]) => pattern.test(symptom.label.toLocaleLowerCase()))?.[0];
    if (!category) {
      additional.push(symptom);
      continue;
    }
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(symptom);
  }
  for (const [label, items] of grouped) {
    if (items.length < 2) {
      additional.push(...items);
      grouped.delete(label);
    }
  }
  if (additional.length === 1 && grouped.size > 0) {
    const largestGroup = [...grouped.values()].reduce((largest, items) => (
      items.length > largest.length ? items : largest
    ));
    largestGroup.push(...additional);
  } else if (additional.length > 1) {
    const systemLabel = bodySystemLabels.get(systemId) || 'General';
    grouped.set(`Additional ${systemLabel} Symptoms`, additional);
  }
  return [...grouped]
    .map(([label, items]) => ({
      label,
      symptoms: items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function filterSymptomsByQuery(symptoms, query) {
  const search = query.trim().toLocaleLowerCase();
  return search
    ? symptoms.filter(({ label }) => label.toLocaleLowerCase().includes(search))
    : symptoms;
}

export function getAdditionalSymptomsBySystem() {
  const grouped = {};
  for (const systemId of Object.keys(subcategoryRules)) grouped[systemId] = [];
  for (const feature of dataset.features) {
    const normalized = normalize(feature);
    if (
      existingLabels.has(normalized)
      || mergedFeatureAliases.has(normalized)
      || pediatricOnlySymptom.test(feature)
      || /\b(?:pregnan(?:t|cy)|antenatal|prenatal|gestational)\b/i.test(feature)
      || /\.\d+$/.test(feature)
    ) continue;
    grouped[systemIdForFeature(feature)].push(feature);
  }
  return grouped;
}

function systemIdForFeature(feature) {
  const text = feature.toLocaleLowerCase();
  return systemRules.find(([, pattern]) => pattern instanceof RegExp && pattern.test(text))?.[0] || 'general';
}

export function getDiseaseDatasetMatches(selectedSymptoms, limit = 6) {
  const selectedIndexes = getDatasetFeatureIndexes(selectedSymptoms);
  if (!selectedIndexes.length) return [];

  const weights = selectedIndexes.map((featureIndex) => {
    const prevalence = (globalCounts.get(featureIndex) || 0) / totalRows;
    return Math.max(0.1, Math.log(1 / Math.max(prevalence, 1 / totalRows)));
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  return dataset.diseases.filter(([, samples]) => samples >= 30).map(([disease, samples, symptomCounts]) => {
    const counts = new Map(symptomCounts);
    let weightedMatch = 0;
    const matched = [];
    for (let i = 0; i < selectedIndexes.length; i++) {
      const featureIndex = selectedIndexes[i];
      const count = counts.get(featureIndex) || 0;
      if (count > 0) matched.push({ feature: dataset.features[featureIndex], count, samples });
      weightedMatch += weights[i] * (count / samples);
    }
    return {
      id: `dataset:${normalize(disease).replace(/\s+/g, '-')}`,
      name: disease.replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()),
      score: Math.round((weightedMatch / weightTotal) * 100),
      samples,
      matched,
    };
  })
    .filter((match) => match.matched.length > 0)
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

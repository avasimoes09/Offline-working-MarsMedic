import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMission } from '@/lib/MissionContext';
import PageHeader from '@/components/PageHeader';
import { BODY_SYSTEMS, SYMPTOMS } from '@/lib/missionData';
import { runDiagnosis } from '@/lib/diagnosisEngine';
import { interpretVitals } from '@/lib/vitalGuidance';
import { getFollowupsForSymptoms } from '@/lib/followupQuestions';
import {
  DATASET_SYMPTOM_PREFIX,
  capitalizeSymptom,
  getAdditionalSymptomsBySystem,
  filterSymptomsByQuery,
  getSymptomsBySubcategory,
} from '@/lib/diseaseDataset';
import { celsiusToFahrenheit, formatTemperature } from '@/lib/temperature';
import VitalsTelemetry from '@/components/VitalsTelemetry';
import MedicalCopilot from '@/pages/MedicalCopilot';
import { Stethoscope, ChevronRight, Check, X, AlertTriangle, Sparkles, ClipboardList, Radio, Search } from 'lucide-react';

const ADDITIONAL_SYMPTOMS_BY_SYSTEM = getAdditionalSymptomsBySystem();
const SYMPTOM_GROUPS_BY_SYSTEM = Object.fromEntries(BODY_SYSTEMS.map(({ id }) => {
  const symptoms = [
    ...(SYMPTOMS[id] || []),
    ...(ADDITIONAL_SYMPTOMS_BY_SYSTEM[id] || []).map((label) => ({
      id: `${DATASET_SYMPTOM_PREFIX}${label}`,
      label,
    })),
  ];
  return [id, getSymptomsBySubcategory(id, symptoms)];
}));

function symptomLabel(id) {
  if (id.startsWith(DATASET_SYMPTOM_PREFIX)) return capitalizeSymptom(id.slice(DATASET_SYMPTOM_PREFIX.length));
  const label = Object.values(SYMPTOMS).flat().find((symptom) => symptom.id === id)?.label || id;
  return capitalizeSymptom(label);
}

export default function SymptomAssessment({ emergency = false }) {
  const { state } = useLocation();
  const navigate = useNavigate();
  const {
    setDiagnosis,
    liveVitals: patientVitals,
    queueEmergencyPacket,
    temperatureUnit,
    crew,
    events,
    isGuest,
    saveAssessmentHistory,
    loadInventory,
  } = useMission();
  const [externalVitals, setExternalVitals] = useState(null);
  const liveVitals = emergency ? externalVitals : patientVitals;
  const [systems, setSystems] = useState(state?.system ? [state.system] : []);
  const [selected, setSelected] = useState([]);
  const [symptomQuery, setSymptomQuery] = useState('');
  const [followups, setFollowups] = useState({});
  const [result, setResult] = useState(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [assessmentRecord, setAssessmentRecord] = useState(null);
  const [historySaveError, setHistorySaveError] = useState('');
  const [historySaveMessage, setHistorySaveMessage] = useState('');
  const [savingHistory, setSavingHistory] = useState(false);
  const [inventoryLoadError, setInventoryLoadError] = useState('');
  const [emergencyContactQueued, setEmergencyContactQueued] = useState(false);
  const historyWriteQueue = useRef(Promise.resolve());

  const followupQuestions = useMemo(() => getFollowupsForSymptoms(selected), [selected]);
  const normalizedSymptomQuery = symptomQuery.trim().toLocaleLowerCase();
  const matchingSystemIds = BODY_SYSTEMS
    .filter(({ id }) => SYMPTOM_GROUPS_BY_SYSTEM[id].some((group) => (
      filterSymptomsByQuery(group.symptoms, normalizedSymptomQuery).length > 0
    )))
    .map(({ id }) => id);
  const displayedSystemIds = normalizedSymptomQuery ? matchingSystemIds : systems;
  const vitalGuidance = useMemo(
    () => emergency ? interpretVitals(externalVitals, selected) : [],
    [emergency, externalVitals, selected],
  );

  useEffect(() => {
    if (state?.system) {
      setSystems([state.system]);
      setResult(null);
    }
  }, [state]);

  const toggleSystem = (id) => setSystems((prev) => (prev.includes(id) ? [] : [id]));
  const toggleSymptom = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleFollow = (k, v) => setFollowups((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  const formatFollowupOption = (option) => temperatureUnit === 'F'
    ? option.replace(/(\d+(?:\.\d+)?)°C/g, (_, value) => `${celsiusToFahrenheit(value).toFixed(1)}°F`)
    : option;
  const persistAssessment = (record) => {
    if (!crew || isGuest) return Promise.resolve();
    setSavingHistory(true);
    setHistorySaveError('');
    setHistorySaveMessage('');
    const save = historyWriteQueue.current.catch(() => {}).then(() => saveAssessmentHistory(record));
    historyWriteQueue.current = save;
    return save.then(() => {
      setHistorySaveMessage('Assessment saved to this patient’s records.');
    }).catch((error) => {
      setHistorySaveError(error.message);
    }).finally(() => {
      setSavingHistory(false);
    });
  };
  const diagnose = async () => {
    let inventoryItems = [];
    setInventoryLoadError('');
    try {
      const { inventory } = await loadInventory();
      inventoryItems = Array.isArray(inventory?.medicalItems) ? inventory.medicalItems : [];
    } catch (error) {
      setInventoryLoadError(error.message);
    }
    const res = runDiagnosis(selected, followups, {
      ...(crew || {}),
      currentVitals: liveVitals,
      events,
      inventoryItems,
    });
    setResult(res);
    const selectedId = res.results[0]?.id || null;
    setSelectedCandidateId(selectedId);
    const record = {
      id: crypto.randomUUID(),
      assessedAt: new Date().toISOString(),
      symptoms: selected.map(symptomLabel),
      candidates: res.results.map((candidate) => ({
        ...candidate,
        matched: candidate.matched.map(symptomLabel),
      })),
      selectedCandidateId: selectedId,
      vitals: liveVitals || {},
      rejected: res.rejected,
    };
    setAssessmentRecord(record);
    if (crew && !isGuest) await persistAssessment(record);
    else setHistorySaveMessage('Guest assessments are not saved to patient records.');
  };
  const reset = () => { setSystems([]); setSelected([]); setFollowups({}); setResult(null); setSelectedCandidateId(null); setAssessmentRecord(null); setHistorySaveError(''); setHistorySaveMessage(''); setEmergencyContactQueued(false); };
  const selectCandidate = (candidateId) => {
    setSelectedCandidateId(candidateId);
    if (!assessmentRecord || isGuest) return;
    const updated = { ...assessmentRecord, selectedCandidateId: candidateId };
    setAssessmentRecord(updated);
    void persistAssessment(updated);
  };
  const startTreatment = (dx) => { setDiagnosis(dx); navigate('/treatment'); };
  const toEarth = (dx) => { setDiagnosis(dx); navigate('/earth-alert'); };
  const selectedCandidate = result?.results.find((candidate) => candidate.id === selectedCandidateId) || result?.results[0];
  const queueGuestEarthAlert = (diagnosis) => {
    queueEmergencyPacket({
      patient: 'Guest patient',
      symptoms: diagnosis.evidence || [],
      diagnosis: diagnosis.name,
      severity: diagnosis.severity,
      confidence: diagnosis.confidence,
      vitals: liveVitals ? {
        hr: liveVitals.hr,
        bp: liveVitals.bpSys ? `${liveVitals.bpSys}/${liveVitals.bpDia}` : null,
        temp: liveVitals.temp,
        spo2: liveVitals.spo2,
        respiratoryRate: liveVitals.respiratoryRate,
      } : null,
      treatments: diagnosis.treatment || [],
      createdAt: new Date().toISOString(),
    });
    setEmergencyContactQueued(true);
  };
  const contactEarth = () => {
    const diagnosisResult = selectedCandidate;
    queueEmergencyPacket({
      patient: 'Emergency patient',
      symptoms: selected.map(symptomLabel),
      diagnosis: diagnosisResult?.name || 'Emergency assistance requested',
      severity: diagnosisResult?.severity || 'UNASSESSED',
      confidence: diagnosisResult?.confidence ?? null,
      vitals: externalVitals,
      createdAt: new Date().toISOString(),
    });
    setEmergencyContactQueued(true);
  };
  const queueCopilotEarthContact = (copilot) => {
    const diagnosisResult = selectedCandidate;
    queueEmergencyPacket({
      patient: 'Emergency patient',
      symptoms: selected.map(symptomLabel),
      diagnosis: diagnosisResult?.name || 'Copilot emergency request',
      severity: diagnosisResult?.severity || 'UNASSESSED',
      confidence: diagnosisResult?.confidence ?? null,
      vitals: externalVitals,
      ...copilot,
      createdAt: new Date().toISOString(),
    });
    setEmergencyContactQueued(true);
  };
  const emergencyContact = (
    <button onClick={contactEarth} disabled={emergencyContactQueued} className="flex min-h-14 w-full items-center justify-between rounded-md border border-amber-700 bg-amber-950/40 px-4 py-3 text-left text-amber-200 transition hover:bg-amber-900/50 disabled:opacity-70">
      <span className="flex items-center gap-2 font-semibold"><Radio className="h-5 w-5" /> Earth Alert</span>
      <span className="text-xs text-amber-300">{emergencyContactQueued ? 'Queued locally' : 'Prepare emergency packet'}</span>
    </button>
  );
  const emergencyVitalsSummary = externalVitals && (
    <div className="panel mb-4 p-4">
      <div className="mb-3 text-sm font-semibold text-slate-100">Vital-sign context</div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-400">Heart rate</div><div className="font-mono text-lg text-slate-100">{externalVitals.hr ?? '—'} bpm</div></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-400">Oxygen saturation</div><div className="font-mono text-lg text-slate-100">{externalVitals.spo2 ?? '—'}%</div></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-400">Blood pressure</div><div className="font-mono text-lg text-slate-100">{externalVitals.bpSys ? `${externalVitals.bpSys}/${externalVitals.bpDia}` : '—'} mmHg</div></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-400">Temperature</div><div className="font-mono text-lg text-slate-100">{formatTemperature(externalVitals.temp, temperatureUnit)}</div></div>
      </div>
      {vitalGuidance.length ? (
        <ul className="space-y-2">
          {vitalGuidance.map((flag) => (
            <li key={flag.key} className={`rounded-md border p-3 text-sm ${flag.urgency === 'urgent' ? 'border-red-700 bg-red-950/40 text-red-100' : 'border-amber-800 bg-amber-950/30 text-amber-100'}`}>
              <div className="font-semibold">{flag.label}: {flag.value}</div>
              <p className="mt-1">{flag.guidance}</p>
              <p className="mt-1 text-xs">Can be relevant with: {flag.relatedSymptoms.map(symptomLabel).join(', ')}{flag.selectedSymptoms.length ? ` · Selected: ${flag.selectedSymptoms.map(symptomLabel).join(', ')}` : ''}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No reference flags for the available values. Normal readings do not rule out an emergency.</p>
      )}
      <p className="mt-3 text-xs text-slate-500">General adult reference guidance only. Recheck readings; devices and individual baselines vary. Vitals alone cannot diagnose a condition.</p>
    </div>
  );
  const emergencyDashboard = emergency && (
    <div className="grid flex-1 items-stretch gap-5 lg:min-h-[calc(100dvh-8rem)] lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]">
      <MedicalCopilot embedded emergency onContactEarth={queueCopilotEarthContact} contactQueued={emergencyContactQueued} />
      <aside className="flex flex-col gap-4">
        {emergencyContact}
        <VitalsTelemetry compact showAttach={false} onReadingsChange={setExternalVitals} className="flex-1" />
        {emergencyVitalsSummary}
      </aside>
    </div>
  );

  if (emergency) {
    return (
      <div className="flex min-h-[calc(100dvh-2rem)] flex-col">
        <PageHeader title="Emergency Assessment" subtitle="Emergency response protocol" icon={AlertTriangle} />
        {emergencyDashboard}
      </div>
    );
  }

  if (result) {
    const top = selectedCandidate;
    const sev = top?.severity === 'EMERGENCY' || top?.severity === 'HIGH' ? 'red' : 'amber';
    return (
      <div>
        <PageHeader
          title={emergency ? 'Emergency Triage Guidance' : 'Assessment Matches'}
          subtitle={emergency ? 'Symptom-based decision support' : 'Local symptom decision support'}
          icon={Sparkles}
          onBack={() => setResult(null)}
          backLabel="Back to assessment"
        />
        {emergencyDashboard}
        {emergency && emergencyVitalsSummary}
        {!top ? (
          <div className="panel p-6">
            <div className="text-lg text-slate-100">No critical pattern detected.</div>
            <p className="mt-2 text-sm text-slate-400">Monitor symptoms and reassess in 2 hours. If condition worsens, initiate Emergency Protocol.</p>
            <button onClick={reset} className="btn-mission mt-4">New Assessment</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="panel p-5">
              <div className="mb-1 text-lg font-semibold text-slate-100">Best-fitting symptom pattern and other matches</div>
              <p className="mb-4 text-xs text-amber-200">The first built-in pattern is the closest rule match to the selected symptoms; dataset associations are secondary comparisons, not probabilities.</p>
              {historySaveError ? (
                <div role="alert" className="mb-4 rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                  Assessment history could not be saved: {historySaveError}
                  {assessmentRecord && <button onClick={() => void persistAssessment(assessmentRecord)} disabled={savingHistory} className="ml-2 underline disabled:opacity-50">{savingHistory ? 'Saving…' : 'Retry'}</button>}
                </div>
              ) : (
                <p role="status" className="mb-4 text-xs text-emerald-300">{savingHistory ? 'Saving assessment to the patient record…' : historySaveMessage}</p>
              )}
              {inventoryLoadError && <p role="status" className="mb-4 text-xs text-amber-200">Inventory could not be loaded for supportive-supply matching: {inventoryLoadError}</p>}
              <div role="radiogroup" aria-label="Possible explanations" className="space-y-2">
                {result.results.map((candidate) => {
                  const isSelected = candidate.id === top.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => selectCandidate(candidate.id)}
                      className={`flex w-full items-center gap-3 rounded-md border p-3 text-left ${isSelected ? 'border-blue-500 bg-blue-950/40' : 'border-slate-700 bg-slate-900 hover:border-blue-700'}`}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-blue-400' : 'border-slate-500'}`}>
                        {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-100">{candidate.name}</span>
                        <span className="text-xs text-slate-400">{candidate.source}{candidate.sampleCount ? ` · ${candidate.sampleCount} source records` : ''}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-lg text-blue-200">{candidate.matchScore}%</span>
                        <span className="text-[10px] text-slate-500">match</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {top && (
                <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-100">{top.name}</h3>
                    <span className={`chip ${sev === 'red' ? 'border-red-800 bg-red-950/40 text-red-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                      {top.severity === 'UNASSESSED' ? 'Severity not assessed' : top.severity}
                    </span>
                  </div>
                  <div className="mt-3 text-xs font-medium text-emerald-300">Matching evidence</div>
                  <ul className="mt-2 space-y-1">
                    {top.evidence.map((e, i) => <li key={i} className="flex items-start gap-2 text-sm text-slate-300"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {e}</li>)}
                  </ul>
                  {top.historyFactors?.length > 0 && (
                    <p className="mt-3 text-xs text-blue-200">Prior patient record: {top.historyFactors.map((factor) => factor.label).join(', ')}</p>
                  )}
                  <div className="mt-4 text-xs font-medium text-slate-300">Plan to review</div>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-300">
                    {top.treatment.map((step, index) => <li key={index}>{step}</li>)}
                  </ol>
                  {top.inventorySupport?.length > 0 && (
                    <div className="mt-4 rounded-md border border-emerald-900/70 bg-emerald-950/20 p-3">
                      <div className="text-xs font-semibold text-emerald-300">Relevant items found in inventory</div>
                      {top.inventorySupport.map((support) => (
                        <p key={support.label} className="mt-1 text-xs text-slate-300">{support.label}: {support.items.join(', ')}</p>
                      ))}
                      <p className="mt-2 text-[11px] text-amber-200">These are stock matches, not instructions to use. Follow onboard medical protocols and Mission Control directions.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {!emergency && (
              <div className="panel p-4">
                <div className="mb-2 text-sm font-semibold text-slate-100">Patient record context</div>
                <p className="text-xs text-slate-400">
                  {result.medicalHistory.factors.length
                    ? `Relevant patient-record context checked: ${result.medicalHistory.factors.map((factor) => factor.label).join(', ')}.`
                    : result.medicalHistory.historyRecorded
                      ? 'Recorded medical history was checked. It may affect built-in rules when a known link exists; the supplied dataset does not model medication interactions.'
                      : 'No medical history is recorded. Symptoms remain the primary evidence.'}
                </p>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><span className="text-slate-400">Allergies: </span><span className="text-slate-200">{result.medicalHistory.allergies || 'Not recorded'}</span></div>
                  <div><span className="text-slate-400">Current medications: </span><span className="text-slate-200">{result.medicalHistory.medications || 'Not recorded'}</span></div>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><span className="text-slate-400">Recorded conditions: </span><span className="text-slate-200">{result.medicalHistory.conditions.join(', ') || 'None recorded'}</span></div>
                  <div><span className="text-slate-400">Current vitals: </span><span className="text-slate-200">
                    {Object.entries(result.medicalHistory.currentVitals).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `${key === 'oxygenSaturation' ? 'SpO₂' : key}: ${key === 'temperature' ? formatTemperature(value, temperatureUnit) : value}`).join(' · ') || 'Not available'}
                  </span></div>
                </div>
                <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 p-3 text-sm">
                  <div className="font-medium text-slate-200">Recent wellbeing logs</div>
                  <div className="mt-1 text-slate-400">Average sleep: {result.wellness.averageSleepHours === null ? 'not logged' : `${result.wellness.averageSleepHours} h/night`}; food entries: {result.wellness.nutritionEntries}.</div>
                  {result.wellness.recentFoods.length > 0 && <div className="mt-1 text-xs text-slate-400">Recent foods: {result.wellness.recentFoods.join(', ')}</div>}
                  <p className="mt-2 text-xs text-slate-500">Food logs contain names and amounts, not nutrient measurements. Nutrient levels are not inferred or included in match scores.</p>
                </div>
                <p className="mt-3 text-xs text-amber-200">Recheck vital values. Dataset matches are not calibrated probabilities. Use treatments only under the onboard medical protocol or Mission Control direction; verify allergies and interactions.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {!emergency && <button onClick={() => startTreatment(top)} className="btn-mission"><ClipboardList className="h-5 w-5" /> Open Plan for {top.name}</button>}
              {!emergency && !isGuest && <button onClick={() => toEarth(top)} className="btn-mission text-amber-300 hover:bg-amber-950/40 hover:border-amber-700"><Radio className="h-5 w-5" /> Generate Earth Alert</button>}
              {!emergency && isGuest && (top.severity === 'HIGH' || top.severity === 'EMERGENCY') && (
                <button onClick={() => queueGuestEarthAlert(top)} disabled={emergencyContactQueued} className="btn-mission border-amber-700 text-amber-300 hover:bg-amber-950/40 disabled:opacity-60">
                  <Radio className="h-5 w-5" /> {emergencyContactQueued ? 'Emergency alert queued locally' : 'Alert Earth'}
                </button>
              )}
              <button onClick={reset} className="btn-mission">New Assessment</button>
            </div>
            {isGuest && emergencyContactQueued && <p role="status" className="text-sm text-amber-300">Emergency alert queued on this device. It will transmit when a communication link is available.</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={emergency ? 'Emergency Assessment' : 'Symptom Assessment'} subtitle={emergency ? 'Quick symptom triage · No account required' : 'Tap to select · Mix body systems'} icon={emergency ? AlertTriangle : Stethoscope} />
      {emergencyDashboard}
      {emergency && emergencyVitalsSummary}
      {liveVitals && (
        <div className="panel mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm text-slate-300">
          <span className="chip border-blue-800 bg-blue-950/40 text-blue-300">Live Vitals · {liveVitals.source}</span>
          <span>HR {liveVitals.hr ?? '—'}</span>
          <span>SpO₂ {liveVitals.spo2 ?? '—'}</span>
          <span>BP {liveVitals.bpSys ? `${liveVitals.bpSys}/${liveVitals.bpDia}` : '—'}</span>
          <span>TEMP {formatTemperature(liveVitals.temp, temperatureUnit)}</span>
        </div>
      )}
      <label className="panel mb-4 flex items-center gap-3 p-3">
        <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Search symptoms</span>
        <input
          type="search"
          value={symptomQuery}
          onChange={(event) => setSymptomQuery(event.target.value)}
          placeholder="Search symptoms..."
          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          aria-label="Search symptoms"
        />
        {symptomQuery && <button type="button" onClick={() => setSymptomQuery('')} className="text-xs text-blue-300 hover:text-blue-100">Clear</button>}
      </label>
      <div className="mb-2 text-xs font-medium text-slate-400">Symptom category · tap one category to open</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BODY_SYSTEMS.filter(({ id }) => !normalizedSymptomQuery || matchingSystemIds.includes(id)).map((s) => {
          const active = systems.includes(s.id);
          return (
            <button key={s.id} onClick={() => toggleSystem(s.id)} className={`panel flex flex-col items-center gap-2 p-4 transition ${active ? 'border-blue-500 bg-blue-950/50' : 'hover:border-blue-500 hover:bg-slate-800'}`}>
              <span className="text-sm font-medium text-slate-200">{s.label}</span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="panel mt-4 p-3">
          <div className="mb-2 text-xs font-medium text-slate-400">Selected Symptoms ({selected.length})</div>
          <div className="flex flex-wrap gap-2">
            {selected.map((id) => (
              <button key={id} onClick={() => toggleSymptom(id)} className="chip border-blue-800 bg-blue-950/40 text-blue-300">
                {symptomLabel(id)} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      {displayedSystemIds.map((sysId) => {
        const sysObj = BODY_SYSTEMS.find((s) => s.id === sysId);
        const symptomGroups = SYMPTOM_GROUPS_BY_SYSTEM[sysId]
          .map((group) => ({
            ...group,
            symptoms: normalizedSymptomQuery
              ? filterSymptomsByQuery(group.symptoms, normalizedSymptomQuery)
              : group.symptoms,
          }))
          .filter((group) => group.symptoms.length > 0);
        return (
          <div key={sysId} className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-slate-200">{sysObj.label}</div>
              {!normalizedSymptomQuery && <button onClick={() => toggleSystem(sysId)} className="text-xs text-blue-400 hover:underline">Close</button>}
            </div>
            <div className="space-y-2">
              {symptomGroups.map((group) => (
                <details key={group.label} open={Boolean(normalizedSymptomQuery)} className="rounded-lg border border-slate-800 bg-slate-900/70">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-200">
                    {group.label} <span className="text-xs text-slate-500">({group.symptoms.length})</span>
                  </summary>
                  <div className="grid grid-cols-1 gap-2 border-t border-slate-800 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.symptoms.map((symptom) => {
                      const on = selected.includes(symptom.id);
                      return (
                        <button key={symptom.id} onClick={() => toggleSymptom(symptom.id)} className={`flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm font-medium transition ${on ? 'border-blue-500 bg-blue-950/50 text-slate-100' : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-blue-600'}`}>
                          {capitalizeSymptom(symptom.label)}{on && <Check className="h-4 w-4 shrink-0 text-blue-400" />}
                        </button>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      })}

      {normalizedSymptomQuery && matchingSystemIds.length === 0 && <p className="mt-4 text-sm text-slate-400">No symptoms match “{symptomQuery}”.</p>}
      <p className="mt-4 text-xs text-slate-500">Symptoms are grouped into subcategories. Dataset matching is unvalidated decision support, not a medical diagnosis.</p>

      {followupQuestions.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="text-xs font-medium text-slate-400">Additional questions · refine the assessment context</div>
          {followupQuestions.map((f) => (
            <div key={f.key} className="panel p-4">
              <div className="mb-2 text-sm text-slate-200">{f.q}</div>
              <div className="flex flex-wrap gap-2">
                {f.options.map((o) => {
                  const on = followups[f.key] === o;
                  return <button key={o} onClick={() => toggleFollow(f.key, o)} className={`rounded-md border px-4 py-2 text-sm ${on ? 'border-blue-500 bg-blue-950/50 text-slate-100' : 'border-slate-700 text-slate-300 hover:border-blue-600'}`}>{formatFollowupOption(o)}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <button disabled={selected.length === 0} onClick={diagnose} className="btn-mission mt-6 w-full"><Sparkles className="h-5 w-5" /> Review Symptom Matches <ChevronRight className="h-5 w-5" /></button>
    </div>
  );
}
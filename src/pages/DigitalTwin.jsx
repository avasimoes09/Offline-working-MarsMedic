import { useNavigate } from 'react-router-dom';
import { useMission } from '@/lib/MissionContext';
import PageHeader from '@/components/PageHeader';
import { Activity, Pencil } from 'lucide-react';
import { formatTemperature } from '@/lib/temperature';
import {
  formatPatientHistoryEvent,
  getPatientWellnessEntries,
  summarizePatientAssessment,
  summarizePatientHistoryEvent,
  summarizePatientWellness,
} from '@/lib/patientRecordFormat';

function HealthField({ label, value }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <div className="text-[11px] font-medium uppercase text-slate-400">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{value || 'Not recorded'}</div>
    </div>
  );
}

export default function DigitalTwin() {
  const { crew, liveVitals, temperatureUnit } = useMission();
  const navigate = useNavigate();
  const conditions = Array.isArray(crew?.conditions) ? crew.conditions : [];
  const assessmentHistory = Array.isArray(crew?.assessmentHistory) ? [...crew.assessmentHistory].reverse() : [];
  const wellnessEntries = getPatientWellnessEntries(crew || {});
  const wellnessSummary = summarizePatientWellness(wellnessEntries);
  const sessionHistory = Array.isArray(crew?.medicalHistoryEntries)
    ? [...crew.medicalHistoryEntries]
      .map((entry) => ({
        ...entry,
        entries: Array.isArray(entry?.entries)
          ? entry.entries.filter((event) => String(event?.details || '').trim())
          : [],
      }))
      .filter((entry) => entry.entries.length)
      .reverse()
    : [];

  if (!crew) {
    return (
      <div>
        <PageHeader title="Patient Health Record" subtitle="No patient selected" icon={Activity} />
        <div className="panel p-6 text-sm text-slate-400">Select or add a patient profile to view health information.</div>
        <button onClick={() => navigate('/crew')} className="btn-mission mt-4">Manage patient profiles</button>
      </div>
    );
  }

  const fields = [
    ['Date of birth', crew.dateOfBirth],
    ['Blood type', crew.bloodType],
    ['Allergies', crew.allergies],
    ['Current medications', crew.medications],
    ['Medical conditions and history', crew.medicalHistory],
    ['Additional health notes', crew.notes],
    ['Recorded heart rate', crew.heartRate ? `${crew.heartRate} bpm` : ''],
    ['Recorded blood pressure', crew.bloodPressure],
    ['Recorded temperature', crew.temperature ? formatTemperature(crew.temperature, temperatureUnit) : ''],
    ['Recorded oxygen saturation', crew.oxygenSaturation ? `${crew.oxygenSaturation}%` : ''],
    ['Recorded respiratory rate', crew.respiratoryRate ? `${crew.respiratoryRate}/min` : ''],
  ];

  return (
    <div>
      <PageHeader title="Patient Records" subtitle={crew.name} icon={Activity} />
      <div className="mb-4 flex justify-end">
        <button onClick={() => navigate('/crew')} className="btn-mission py-2 text-sm"><Pencil className="h-4 w-4" /> Manage profiles</button>
      </div>
      {liveVitals && (
        <div className="panel panel-glow mb-4 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100"><Activity className="h-4 w-4 text-blue-400" />Live Vitals · {liveVitals.source}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <HealthField label="Heart rate" value={liveVitals.hr ? `${liveVitals.hr} bpm` : ''} />
            <HealthField label="Blood pressure" value={liveVitals.bpSys ? `${liveVitals.bpSys}/${liveVitals.bpDia} mmHg` : ''} />
            <HealthField label="Temperature" value={liveVitals.temp != null ? formatTemperature(liveVitals.temp, temperatureUnit) : ''} />
            <HealthField label="Oxygen saturation" value={liveVitals.spo2 ? `${liveVitals.spo2}%` : ''} />
            <HealthField label="Respiratory rate" value={liveVitals.respiratoryRate ? `${liveVitals.respiratoryRate}/min` : ''} />
          </div>
        </div>
      )}
      <div className="panel panel-glow mb-4 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">Saved device readings</div>
        {crew.deviceReadings?.length ? (
          <ul className="space-y-3">
            {[...crew.deviceReadings].reverse().slice(0, 20).map((reading, index) => (
              <li key={`${reading.recordedAt}-${index}`} className="border-b border-slate-800 pb-3 last:border-0 last:pb-0">
                <div className="text-xs text-slate-400">
                  {reading.type === 'environmental' ? 'Environmental sensor' : 'Vital-sign device'} · {reading.source} · {new Date(reading.recordedAt).toLocaleString()}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-200">
                  {Object.entries(reading.readings || {}).map(([key, value]) => (
                    <span key={key}>{key}: {value}{key === 'hr' ? ' bpm' : key === 'spo2' || key === 'humidity' ? '%' : key === 'bpSys' || key === 'bpDia' ? ' mmHg' : key === 'temp' || key === 'temperatureC' ? ' °C' : key === 'pressureKpa' ? ' kPa' : key === 'co2Ppm' ? ' ppm' : ''}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-400">No device readings have been saved.</div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([label, value]) => <HealthField key={label} label={label} value={value} />)}
      </div>
      <div className="panel mt-4 p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">Assessment history</div>
        {assessmentHistory.length ? (
          <ul className="space-y-4 text-sm text-slate-300">
            {assessmentHistory.map((assessment) => {
              const selected = assessment.candidates?.find((candidate) => candidate.id === assessment.selectedCandidateId);
              return (
                <li key={assessment.id} className="border-b border-slate-800 pb-4 last:border-0 last:pb-0">
                  <details>
                    <summary className="cursor-pointer font-medium text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
                      {summarizePatientAssessment(assessment)}
                    </summary>
                    <div className="mt-2 border-l border-slate-700 pl-3">
                      <div className="text-slate-400">Symptoms: {assessment.symptoms?.join(', ') || 'Not recorded'}</div>
                      {assessment.candidates?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {assessment.candidates.map((candidate) => (
                            <li key={candidate.id}>
                              {candidate.name} · {candidate.matchScore}% non-calibrated match · {candidate.severity}
                            </li>
                          ))}
                        </ul>
                      )}
                      {selected?.evidence?.length > 0 && <div className="mt-2 text-xs text-slate-400">Matching evidence: {selected.evidence.join('; ')}</div>}
                      {selected?.treatment?.length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs font-medium text-slate-400">Plan to review with a clinician</div>
                          <ul className="mt-1 list-inside list-disc text-xs text-slate-400">{selected.treatment.map((step, index) => <li key={index}>{step}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-sm text-slate-400">{conditions.length ? conditions.map((condition) => `${condition.name} · ${condition.severity} · ${new Date(condition.date).toLocaleDateString()}`).join('; ') : 'No assessments recorded for this patient.'}</div>
        )}
        <p className="mt-3 text-xs text-amber-200">Match scores are not diagnostic probabilities or validated diagnoses. Have a qualified clinician review assessment findings and plans.</p>
      </div>
      <div className="panel mt-4 p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">Sleep and food summary</div>
        <p className="text-sm text-slate-300">
          {wellnessSummary.sleepEntries
            ? `Average sleep across ${wellnessSummary.sleepEntries} logged ${wellnessSummary.sleepEntries === 1 ? 'night' : 'nights'}: ${wellnessSummary.averageSleepHours} hours.`
            : 'No sleep entries are recorded yet.'}
          {' '}
          {wellnessSummary.foodEntries
            ? `${wellnessSummary.foodEntries} food ${wellnessSummary.foodEntries === 1 ? 'entry' : 'entries'} recorded${wellnessSummary.recentFoods.length ? `, including ${wellnessSummary.recentFoods.join(', ')}` : ''}.`
            : 'No food entries are recorded yet.'}
        </p>
        <p className="mt-2 text-xs text-slate-500">Food logs record names and portions only; they do not measure nutrients or blood nutrient levels.</p>
        {wellnessEntries.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-slate-800 pt-3 text-sm text-slate-300">
            {wellnessEntries.map((entry) => (
              <li key={entry.id}>
                <details>
                  <summary className="cursor-pointer text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
                    {summarizePatientHistoryEvent(entry)}
                  </summary>
                  <p className="mt-1 border-l border-slate-700 pl-3 text-slate-400">{formatPatientHistoryEvent(entry)}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel mt-4 p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">Session medical history</div>
        {sessionHistory.length ? (
          <ul className="space-y-3 text-sm text-slate-300">
            {sessionHistory.map((entry, index) => (
              <li key={`${entry.endedAt}-${index}`} className="border-b border-slate-800 pb-3 last:border-0 last:pb-0">
                <div className="text-xs text-slate-400">
                  Session ended {entry.endedAt ? new Date(entry.endedAt).toLocaleString() : 'at unknown time'} · {entry.entries.length} {entry.entries.length === 1 ? 'event' : 'events'}
                </div>
                <ul className="mt-2 space-y-2">
                  {entry.entries.map((item, itemIndex) => (
                    <li key={`${item.at}-${itemIndex}`}>
                      <details>
                        <summary className="cursor-pointer text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
                          {summarizePatientHistoryEvent(item)}
                        </summary>
                        <p className="mt-1 border-l border-slate-700 pl-3 text-slate-400">
                          {formatPatientHistoryEvent(item) || 'No details recorded.'}
                        </p>
                      </details>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-400">No session history has been recorded.</div>
        )}
      </div>
    </div>
  );
}
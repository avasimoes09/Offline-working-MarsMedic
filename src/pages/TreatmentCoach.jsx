import { useMission } from '@/lib/MissionContext';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { ClipboardList, Check, Stethoscope, Info, LockKeyhole, Home } from 'lucide-react';

// Plain-language explanation shown under steps that call for the Emergency Protocol,
// so the astronaut knows what the instruction actually means.
const EMERGENCY_PROTOCOL_NOTE =
  'Emergency Protocol: switch to critical-care mode. Alert Mission Control immediately, stabilize Airway, Breathing and Circulation (ABC), keep continuous vitals monitoring, and have an Earth Alert Packet ready in case the crew member deteriorates.';

export default function TreatmentCoach() {
  const { diagnosis, completedSteps, toggleStep, resolveCrewCondition } = useMission();
  const navigate = useNavigate();

  if (!diagnosis) {
    return (
      <div>
        <PageHeader title="Treatment Coach" subtitle="Step-by-step care plan" icon={ClipboardList} />
        <div className="panel p-6 text-center">
          <p className="text-slate-300">No active diagnosis. Run an assessment to generate a treatment plan.</p>
          <button onClick={() => navigate('/assessment')} className="btn-mission mt-4"><Stethoscope className="h-5 w-5" /> Start Assessment</button>
        </div>
      </div>
    );
  }

  const steps = diagnosis.treatment;
  const done = completedSteps[diagnosis.id] || [];
  const pct = Math.round((done.length / steps.length) * 100);

  return (
    <div>
      <PageHeader title="Treatment Coach" subtitle={diagnosis.name} icon={ClipboardList} />
      <div className="panel p-5">
        <p className="mb-4 text-xs text-amber-200">Follow the current onboard medical checklist and Mission Control directions. Check allergies and verify medication instructions before use.</p>
        <div className="mb-1 flex justify-between text-xs text-slate-400"><span>Progress</span><span className="font-mono">{pct}%</span></div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      <p className="mt-3 text-sm text-slate-400">Review each step in order. Restarting an earlier step clears the later steps.</p>
      <div className="mt-4 space-y-3">
        {steps.map((s, i) => {
          const on = done.includes(i);
          const locked = i > done.length;
          const isNext = i === done.length;
          const isEmergency = /emergency protocol/i.test(s);
          return (
            <button
              key={i}
              onClick={() => toggleStep(diagnosis.id, i)}
              disabled={locked}
              aria-label={`${on ? 'Restart from' : 'Complete'} step ${i + 1}: ${s}`}
              className={`flex w-full items-center gap-3 rounded-md border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-emerald-700 bg-emerald-950/80' : isNext ? 'border-blue-600 bg-slate-900 hover:border-blue-500' : 'border-slate-800 bg-slate-900'}`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${on ? 'border-emerald-500 bg-emerald-900/80 text-emerald-300' : 'border-slate-600 text-slate-500'}`}>{on ? <Check className="h-4 w-4" /> : null}</span>
              <span className="flex-1">
                <span className={on ? 'text-emerald-300 line-through' : 'text-slate-200'}>{s}</span>
                <span className="mt-1 block text-xs text-slate-500">{on ? 'Complete · click to restart here' : locked ? 'Complete the previous step first' : isNext ? 'Next step' : ''}</span>
                {isEmergency && (
                  <span className="mt-2 flex items-start gap-2 rounded border border-red-900/60 bg-red-950/30 p-2 text-xs leading-relaxed text-red-200">
                    <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
                    {EMERGENCY_PROTOCOL_NOTE}
                  </span>
                )}
              </span>
              {locked && <LockKeyhole className="h-4 w-4 flex-shrink-0 text-slate-500" />}
            </button>
          );
        })}
      </div>
      {diagnosis.inventorySupport?.length > 0 && (
        <div className="panel mt-4 border-emerald-900/70 p-4">
          <div className="text-sm font-semibold text-emerald-300">Relevant supportive supplies in inventory</div>
          <ul className="mt-2 space-y-2 text-sm text-slate-300">
            {diagnosis.inventorySupport.map((support) => (
              <li key={support.label}><span className="text-slate-400">{support.label}: </span>{support.items.join(', ')}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-amber-200">Use supplies only as listed in the onboard protocol or directed by Mission Control; check product directions, allergies, and interactions.</p>
        </div>
      )}
      {pct === 100 && (
        <div className="mt-4 panel border-emerald-700 p-4">
          <div className="text-emerald-300">Treatment plan complete. Continue monitoring patient vitals.</div>
          <button onClick={() => { resolveCrewCondition(diagnosis.id); navigate('/dashboard'); }} className="btn-mission mt-3 border-emerald-700 bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900/90">
            <Home className="h-5 w-5" /> Return Home
          </button>
        </div>
      )}
    </div>
  );
}
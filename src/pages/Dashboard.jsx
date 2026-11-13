import { useNavigate } from 'react-router-dom';
import { useMission } from '@/lib/MissionContext';
import { INVENTORY as SEED } from '@/lib/missionData';
import VitalsTelemetry from '@/components/VitalsTelemetry';
import EnvironmentalTelemetry from '@/components/EnvironmentalTelemetry';
import { AlertTriangle, Fingerprint } from 'lucide-react';
import { useEffect, useState } from 'react';
import { localApi } from '@/lib/localApi';

export default function Dashboard() {
  const navigate = useNavigate();
  const { crew, isGuest } = useMission();
  const [inventory, setInventory] = useState(SEED);
  const [inventoryError, setInventoryError] = useState('');
  useEffect(() => {
    let active = true;
    localApi('/inventory')
      .then(({ inventory: saved }) => {
        if (active && Array.isArray(saved?.medicalItems)) setInventory(saved.medicalItems);
      })
      .catch((error) => { if (active) setInventoryError(error.message); });
    return () => { active = false; };
  }, []);
  const lowStock = inventory.filter((item) => item.quantity < (item.low_threshold ?? (item.unit === 'bags' || item.unit === 'patches' ? 10 : 30)));

  return (
    <div className="space-y-5">
      {!isGuest && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-cyan-300">Mars transit · medical systems</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-100">Medical Readiness</h1>
          </div>
        </div>
      )}
      {!isGuest && crew && !crew.hasPasskey && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-800 bg-cyan-950/30 p-4">
          <div>
            <div className="text-sm font-semibold text-slate-100">Set up fingerprint sign-in</div>
            <p className="mt-1 text-xs text-slate-400">Add a compatible FIDO2 reader or use this device’s biometric prompt.</p>
          </div>
          <button onClick={() => navigate('/crew')} className="btn-mission py-2.5 text-sm">
            <Fingerprint className="h-4 w-4" /> Set up passkey
          </button>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(17rem,0.9fr)_minmax(22rem,1.35fr)_minmax(16rem,0.8fr)]">
        <section aria-labelledby="vitals-heading">
          <div className="mb-2 flex items-center gap-2 text-slate-100">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            <h2 id="vitals-heading" className="text-sm font-semibold">Vitals</h2>
          </div>
          <VitalsTelemetry compact />
        </section>

        <section className="space-y-4" aria-label="Environment">
          <div>
            <div className="mb-2 flex items-center gap-2 text-slate-100">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <h2 className="text-sm font-semibold">Environment</h2>
            </div>
            <EnvironmentalTelemetry />
          </div>
        </section>

        <section aria-labelledby="low-inventory-heading">
          <div className="mb-2 flex items-center gap-2 text-slate-100">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h2 id="low-inventory-heading" className="text-sm font-semibold">Low Inventory</h2>
          </div>
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">Items below threshold</span>
              <span className="chip border-amber-800 bg-amber-950/40 text-amber-300">{lowStock.length}</span>
            </div>
            {inventoryError ? (
              <div role="alert" className="text-xs text-amber-300">Inventory could not be loaded: {inventoryError}</div>
            ) : lowStock.length === 0 ? (
              <div className="text-xs text-slate-400">All supplies nominal.</div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {lowStock.slice(0, 6).map((item) => (
                  <li key={item.name} className="flex items-start justify-between gap-3 py-3 first:pt-1">
                    <span className="text-sm text-slate-300">{item.name}</span>
                    <span className="shrink-0 font-mono text-xs text-amber-300">{item.quantity} {item.unit}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={() => navigate('/inventory')} className="btn-mission mt-3 w-full py-2.5 text-sm">Open inventory</button>
        </section>
      </div>
      <button onClick={() => navigate('/wellness')} className="btn-mission py-2.5 text-sm">Open sleep and food logs</button>
    </div>
  );
}
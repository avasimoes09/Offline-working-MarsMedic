import { useEffect, useMemo, useState } from 'react';
import { useMission } from '@/lib/MissionContext';
import PageHeader from '@/components/PageHeader';
import SleepPanel from '@/components/wellness/SleepPanel';
import FoodPanel from '@/components/wellness/FoodPanel';
import PatternInsights from '@/components/wellness/PatternInsights';
import { analyzeWellness } from '@/lib/wellnessPatterns';
import { todayISO } from '@/lib/wellnessData';
import { Moon, Loader2 } from 'lucide-react';

export default function Wellness() {
  const { crew, isGuest, recordEvent, saveWellnessEntry, deleteWellnessEntry } = useMission();
  const [sleepLogs, setSleepLogs] = useState([]);
  const [mealLogs, setMealLogs] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = Array.isArray(crew?.wellnessEntries) ? crew.wellnessEntries : [];
    setSleepLogs(saved.filter((entry) => entry.type === 'Sleep').map((entry) => ({
      id: entry.id,
      ...entry.details,
      created_date: entry.at,
    })).reverse());
    setMealLogs(saved.filter((entry) => entry.type === 'Nutrition').map((entry) => ({
      id: entry.id,
      ...entry.details,
      created_date: entry.at,
    })).reverse());
    setLoading(false);
  }, [crew?.id, crew?.wellnessEntries]);

  const logSleep = async (entry) => {
    setBusy(true);
    setError('');
    try {
      if (isGuest) recordEvent('Sleep', JSON.stringify(entry));
      const saved = isGuest
        ? { id: `g-${Date.now()}`, type: 'Sleep', details: entry, at: new Date().toISOString() }
        : await saveWellnessEntry('Sleep', entry);
      setSleepLogs((prev) => [{ id: saved.id, ...saved.details, created_date: saved.at }, ...prev]);
    } catch (saveError) {
      setError(`Sleep entry was not saved: ${saveError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const logMeal = async (entry) => {
    setBusy(true);
    setError('');
    try {
      if (isGuest) recordEvent('Nutrition', JSON.stringify(entry));
      const saved = isGuest
        ? { id: `g-${Date.now()}`, type: 'Nutrition', details: entry, at: new Date().toISOString() }
        : await saveWellnessEntry('Nutrition', entry);
      setMealLogs((prev) => [{ id: saved.id, ...saved.details, created_date: saved.at }, ...prev]);
    } catch (saveError) {
      setError(`Food entry was not saved: ${saveError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const removeSleep = async (id) => {
    setBusy(true);
    setError('');
    try {
      if (!isGuest) await deleteWellnessEntry(id);
      setSleepLogs((prev) => prev.filter((log) => log.id !== id));
    } catch (saveError) {
      setError(`Sleep entry was not removed: ${saveError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const removeMeal = async (id) => {
    setBusy(true);
    setError('');
    try {
      if (!isGuest) await deleteWellnessEntry(id);
      setMealLogs((prev) => prev.filter((log) => log.id !== id));
    } catch (saveError) {
      setError(`Food entry was not removed: ${saveError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const analysis = useMemo(() => analyzeWellness(sleepLogs, mealLogs), [sleepLogs, mealLogs]);

  const saveInsight = async (payload) => {
    const record = { ...payload, crew_id: crew?.id, crew_name: crew?.name, generated_on: todayISO() };
    recordEvent('Wellness insight', JSON.stringify(payload));
    setBusy(true);
    try {
      setInsights((prev) => [{ id: `g-${Date.now()}`, ...record, created_date: new Date().toISOString() }, ...prev]);
    } finally {
      setBusy(false);
    }
  };

  const removeInsight = async (id) => {
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <div>
      <PageHeader title="Sleep & Nutrition" subtitle="Daily intake log · crew wellbeing" icon={Moon} />
      {error && <div role="alert" className="mb-4 rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
      {loading ? (
        <div className="panel flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading logs…
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <SleepPanel logs={sleepLogs} onSave={logSleep} onDelete={removeSleep} busy={busy} />
            <FoodPanel logs={mealLogs} onSave={logMeal} onDelete={removeMeal} busy={busy} />
          </div>
          <div className="mt-4">
            <PatternInsights
              analysis={analysis}
              saved={insights}
              onSave={saveInsight}
              onDelete={removeInsight}
              busy={busy}
              crewName={crew?.name}
            />
          </div>
        </>
      )}
    </div>
  );
}
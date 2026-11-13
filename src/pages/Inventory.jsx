import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { INVENTORY as SEED } from '@/lib/missionData';
import { Boxes, AlertTriangle, Plus, Trash2, Check, X, Pencil } from 'lucide-react';
import { localApi } from '@/lib/localApi';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const defaultThreshold = (unit) => (unit === 'bags' || unit === 'patches' ? 10 : 30);
const isLow = (it) => it.quantity < (it.low_threshold ?? defaultThreshold(it.unit));
const UNITS = ['tablets', 'capsules', 'patches', 'bags', 'units', 'vials', 'mL'];
const seedItems = () => SEED.map((s, i) => ({ id: `g_${i}`, name: s.name, quantity: s.quantity, unit: s.unit, description: s.description, usage: s.usage, low_threshold: defaultThreshold(s.unit) }));

const inputCls = 'w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none';

export default function Inventory() {
  const [items, setItems] = useState(null);
  const [foodItems, setFoodItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [storageError, setStorageError] = useState('');

  const load = useCallback(async () => {
    setStorageError('');
    try {
      const { inventory } = await localApi('/inventory');
      if (inventory) {
        setItems(inventory.medicalItems);
        setFoodItems(inventory.foodItems);
        return;
      }

      const initial = {
        medicalItems: seedItems(),
        foodItems: [],
      };
      setItems(initial.medicalItems);
      setFoodItems(initial.foodItems);
    } catch (error) {
      setStorageError(`Inventory could not be loaded or saved: ${error.message}`);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (it) => { setEditing(it.id); setDraft({ ...it }); };
  const startNew = () => {
    setEditing('new');
    setDraft({
      name: '',
      quantity: 0,
      unit: 'tablets',
      description: '',
      usage: '',
      low_threshold: 30,
    });
  };
  const cancel = () => { setEditing(null); setDraft(null); };

  const save = async () => {
    if (!draft?.name || draft.quantity == null) return;
    setSaving(true);
    setStorageError('');
    try {
      const payload = { ...draft, low_threshold: draft.low_threshold ?? defaultThreshold(draft.unit) };
      const nextItems = editing === 'new'
        ? [...items, { ...payload, id: `g_${Date.now()}` }]
        : items.map((it) => it.id === editing ? { ...it, ...payload } : it);
      const result = await localApi('/inventory', {
        method: 'PUT',
        body: { inventory: { medicalItems: nextItems, foodItems } },
      });
      setItems(result.inventory.medicalItems);
      setFoodItems(result.inventory.foodItems);
      cancel();
    } catch (error) {
      setStorageError(`Inventory changes were not saved: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!itemToDelete) return;
    setSaving(true);
    setStorageError('');
    try {
      const nextItems = items.filter((it) => it.id !== itemToDelete.id);
      const result = await localApi('/inventory', {
        method: 'PUT',
        body: { inventory: { medicalItems: nextItems, foodItems } },
      });
      setItems(result.inventory.medicalItems);
      setFoodItems(result.inventory.foodItems);
      setItemToDelete(null);
    } catch (error) {
      setStorageError(`Inventory item was not removed: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const renderItems = (list, emptyMessage) => list.length === 0 ? (
    <div className="panel p-8 text-center">
      <Boxes className="mx-auto mb-3 h-8 w-8 text-slate-400" />
      <p className="text-sm text-slate-300">{emptyMessage}</p>
    </div>
  ) : (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((it) => {
        const low = isLow(it);
        const isEditing = editing === it.id;
        return (
          <div key={it.id} className={`panel p-4 ${low ? 'border-amber-700' : ''}`}>
            {isEditing ? (
              <div className="space-y-3">
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Name" className={inputCls} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <input type="number" min="0" value={draft.quantity} onChange={(e) => set('quantity', Number(e.target.value))} placeholder="Qty" className={inputCls} />
                  <select value={draft.unit} onChange={(e) => set('unit', e.target.value)} className={inputCls} aria-label="Quantity unit">
                    {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                  <input type="number" min="0" value={draft.low_threshold} onChange={(e) => set('low_threshold', Number(e.target.value))} placeholder="Low" className={inputCls} aria-label="Low-stock threshold" />
                </div>
                <input value={draft.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Description" className={inputCls} />
                <textarea value={draft.usage || ''} onChange={(e) => set('usage', e.target.value)} placeholder="Usage or notes" rows={2} className={inputCls} />
                <div className="flex gap-2">
                  <button onClick={save} disabled={saving} className="btn-mission py-2 text-sm"><Check className="h-4 w-4" /> Save</button>
                  <button onClick={cancel} className="btn-mission py-2 text-sm"><X className="h-4 w-4" /> Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">{it.name}</div>
                  </div>
                  <div className={`chip shrink-0 ${low ? 'border-amber-800 bg-amber-950/40 text-amber-300' : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'}`}>{it.quantity} {it.unit}</div>
                </div>
                {it.description && <p className="mt-2 text-sm text-slate-400">{it.description}</p>}
                {it.usage && <div className="mt-2 text-xs text-slate-400"><span className="font-medium">Notes:</span> {it.usage}</div>}
                <div className="mt-1 text-xs text-slate-500">Low-stock threshold: {it.low_threshold ?? defaultThreshold(it.unit)} {it.unit}</div>
                {low && <div className="mt-2 flex items-center gap-1 text-xs text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Low stock — request resupply</div>}
                <div className="mt-3 flex justify-between">
                  <button onClick={() => startEdit(it)} className="btn-mission py-2 text-sm"><Pencil className="h-4 w-4" /> Edit</button>
                  <button onClick={() => setItemToDelete(it)} aria-label={`Delete ${it.name}`} className="btn-mission py-2 text-sm text-red-400 hover:bg-red-950/40 hover:border-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <PageHeader title="Medical Inventory" subtitle="Saved locally on this computer" icon={Boxes} />
      <div className="mb-4 flex items-center justify-end">
        <button onClick={startNew} disabled={items === null || saving} className="btn-mission disabled:opacity-50"><Plus className="h-4 w-4" /> Add Item</button>
      </div>
      {storageError && <div role="alert" className="mb-4 rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{storageError} <button onClick={load} className="ml-2 underline">Retry</button></div>}
      {items === null ? <div className="panel p-6 text-sm text-slate-400">{storageError ? 'Inventory is unavailable until the local service reconnects.' : 'Loading supplies…'}</div> : renderItems(items, 'No medical supplies have been added.')}

      {editing === 'new' && (
        <div className="panel panel-glow mt-4 p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">New Supply</div>
          <div className="space-y-3">
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Name" className={inputCls} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <input type="number" min="0" value={draft.quantity} onChange={(e) => set('quantity', Number(e.target.value))} placeholder="Qty" className={inputCls} />
              <select value={draft.unit} onChange={(e) => set('unit', e.target.value)} className={inputCls}>
                {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
              <input type="number" min="0" value={draft.low_threshold} onChange={(e) => set('low_threshold', Number(e.target.value))} placeholder="Low" className={inputCls} />
            </div>
            <input value={draft.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Description" className={inputCls} />
            <textarea value={draft.usage || ''} onChange={(e) => set('usage', e.target.value)} placeholder="Usage" rows={2} className={inputCls} />
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="btn-mission py-2 text-sm"><Check className="h-4 w-4" /> Save</button>
              <button onClick={cancel} className="btn-mission py-2 text-sm"><X className="h-4 w-4" /> Cancel</button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={itemToDelete !== null} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent className="border-slate-700 bg-slate-900 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This will remove this supply from your inventory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-700 text-white hover:bg-red-600">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
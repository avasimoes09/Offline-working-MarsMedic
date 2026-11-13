import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { localApi } from '@/lib/localApi';
import { createPasskeyOptionsPreloader } from '@/lib/passkeyOptionsPreloader';

const MissionContext = createContext(null);
export const useMission = () => useContext(MissionContext);

const SEVERITY_PENALTY = { EMERGENCY: 30, HIGH: 20, MEDIUM: 10, LOW: 4 };

function validatePasskeyRpId(options) {
  const rpId = options.rp?.id || options.rpId;
  if (rpId !== window.location.hostname) {
    throw new Error(
      `Passkey origin mismatch: this app is open at "${window.location.origin}", but the local service returned RP ID "${rpId || 'missing'}". Close the browser/Codespaces page and launch M. I. A. from the Start menu.`,
    );
  }
}

export function MissionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [patient, setPatient] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [diagnosis, setDiagnosisState] = useState(null);
  const [completedSteps, setCompletedSteps] = useState({});
  const [temperatureUnit, setTemperatureUnitState] = useState('C');
  const [settingsError, setSettingsError] = useState('');
  const [earthQueue, setEarthQueue] = useState([]);
  const [liveVitals, setLiveVitalsState] = useState(null);
  const [events, setEvents] = useState([]);
  const authChannel = useRef(null);
  const passkeyOptionsPreloader = useMemo(() => createPasskeyOptionsPreloader(async () => {
    const options = await localApi('/passkeys/login/options', { method: 'POST', body: {} });
    validatePasskeyRpId(options);
    return options;
  }), []);

  const clearSessionState = useCallback(() => {
    setPatient(null);
    setSession(null);
    setEvents([]);
    setDiagnosisState(null);
    setCompletedSteps({});
    setEarthQueue([]);
    setLiveVitalsState(null);
  }, []);

  const notifyAuthChange = useCallback(() => {
    authChannel.current?.postMessage('session-changed');
  }, []);

  useEffect(() => {
    let active = true;
    localApi('/settings/temperature-unit')
      .then(({ temperatureUnit: unit }) => {
        if (active && (unit === 'C' || unit === 'F')) setTemperatureUnitState(unit);
      })
      .catch((error) => {
        if (active) setSettingsError(`Saved preferences could not be loaded: ${error.message}`);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session) {
      passkeyOptionsPreloader.clear();
      return;
    }
    let active = true;
    let refreshTimeout;
    const preloadOptions = () => {
      passkeyOptionsPreloader.preload().then(() => {
        if (active) refreshTimeout = window.setTimeout(preloadOptions, 3 * 60 * 1000);
      }).catch(() => {
        // If warm-up fails, consume() retries when the user requests passkey sign-in.
      });
    };
    preloadOptions();
    return () => {
      active = false;
      window.clearTimeout(refreshTimeout);
    };
  }, [session, passkeyOptionsPreloader]);

  const isGuest = session?.method === 'guest';
  const recordEvent = useCallback((type, details) => {
    setEvents((current) => [...current, { type, details: String(details || '').slice(0, 1000), at: new Date().toISOString() }].slice(-100));
  }, []);

  const setPatientSession = useCallback(({ profile, startedAt }) => {
    setPatient({
      ...profile,
      conditions: Array.isArray(profile?.conditions) ? profile.conditions : [],
      medicalHistoryEntries: Array.isArray(profile?.medicalHistoryEntries) ? profile.medicalHistoryEntries : [],
    });
    setSession({ method: 'patient', startedAt: startedAt || new Date().toISOString() });
    setEvents([]);
    setDiagnosisState(null);
    setCompletedSteps({});
    setEarthQueue([]);
    setLiveVitalsState(null);
    notifyAuthChange();
  }, [notifyAuthChange]);

  useEffect(() => {
    let active = true;
    localApi('/auth/me')
      .then((result) => { if (active) setPatientSession(result); })
      .catch((error) => {
        if (active && error.status !== 401) {
          setSettingsError(`Saved login session could not be restored: ${error.message}`);
        }
      })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; };
  }, [setPatientSession]);

  const createAccount = useCallback(async (details) => {
    const result = await localApi('/auth/register', { method: 'POST', body: details });
    try {
      const options = await localApi('/passkeys/register/options', { method: 'POST', body: { externalOnly: false } });
      validatePasskeyRpId(options);
      const response = await startRegistration({ optionsJSON: options });
      await localApi('/passkeys/register/verify', {
        method: 'POST',
        body: { ...response, challenge: options.challenge },
      });
      result.profile.hasPasskey = true;
    } catch (error) {
      setPatientSession(result);
      return { fingerprintSetupFailed: true, error };
    }
    setPatientSession(result);
    return { fingerprintSetupFailed: false };
  }, [setPatientSession]);

  const loginWithPin = useCallback(async (pin) => {
    const result = await localApi('/auth/login-pin', { method: 'POST', body: { pin } });
    setPatientSession(result);
  }, [setPatientSession]);

  const loginWithPasskey = useCallback(async () => {
    try {
      const options = await passkeyOptionsPreloader.consume();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await localApi('/passkeys/login/verify', {
        method: 'POST',
        body: { ...response, challenge: options.challenge },
      });
      setPatientSession(result);
    } catch (error) {
      passkeyOptionsPreloader.preload().catch(() => {});
      throw error;
    }
  }, [passkeyOptionsPreloader, setPatientSession]);

  const registerPasskey = useCallback(async ({ externalOnly = false } = {}) => {
    const options = await localApi('/passkeys/register/options', { method: 'POST', body: { externalOnly } });
    validatePasskeyRpId(options);
    const response = await startRegistration({ optionsJSON: options });
    await localApi('/passkeys/register/verify', {
      method: 'POST',
      body: { ...response, challenge: options.challenge },
    });
    setPatient((current) => current ? { ...current, hasPasskey: true } : current);
  }, []);

  const updateProfile = useCallback(async (details) => {
    const result = await localApi('/profile', { method: 'PUT', body: details });
    const updated = {
      ...result.profile,
      conditions: Array.isArray(result.profile?.conditions) ? result.profile.conditions : [],
      medicalHistoryEntries: Array.isArray(result.profile?.medicalHistoryEntries) ? result.profile.medicalHistoryEntries : [],
    };
    setPatient(updated);
    return updated;
  }, []);

  const changePin = useCallback((currentPin, newPin) => (
    localApi('/profile/pin', { method: 'POST', body: { currentPin, newPin } })
  ), []);

  const loginGuest = useCallback(async () => {
    try {
      await localApi('/auth/logout', {
        method: 'POST',
        body: {
          startedAt: session?.startedAt,
          entries: session?.method === 'patient' ? events : [],
        },
      });
    } catch { /* Guest mode remains available if the local service is unavailable. */ }
    setPatient(null);
    setSession({ method: 'guest', startedAt: new Date().toISOString() });
    setEvents([]);
    setDiagnosisState(null);
    setCompletedSteps({});
    setEarthQueue([]);
    setLiveVitalsState(null);
    notifyAuthChange();
  }, [session, events, notifyAuthChange]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('marsmedic-auth');
    authChannel.current = channel;
    const onChange = () => clearSessionState();
    channel?.addEventListener('message', onChange);
    return () => {
      channel?.removeEventListener('message', onChange);
      channel?.close();
    };
  }, [clearSessionState]);

  const logout = useCallback(async () => {
    try {
      if (session?.method === 'patient') {
        await localApi('/session/end', { method: 'POST', body: { startedAt: session.startedAt, entries: events } });
      }
    } finally {
      clearSessionState();
      notifyAuthChange();
    }
  }, [session, events, clearSessionState, notifyAuthChange]);

  const updateDiagnosis = useCallback((next) => {
    setDiagnosisState(next);
    if (next) recordEvent('Assessment', `${next.name || 'Assessment'} · ${next.severity || 'severity not recorded'}`);
  }, [recordEvent]);

  const setTemperatureUnit = useCallback(async (unit) => {
    if (unit !== 'C' && unit !== 'F') return;
    try {
      const result = await localApi('/settings/temperature-unit', {
        method: 'PUT',
        body: { temperatureUnit: unit },
      });
      setTemperatureUnitState(result.temperatureUnit);
      setSettingsError('');
    } catch (error) {
      setSettingsError(`Temperature preference was not saved: ${error.message}`);
    }
  }, []);

  const toggleStep = useCallback((diagnosisId, idx) => {
    if (diagnosis?.id !== diagnosisId || !Number.isInteger(idx) || idx < 0) return;
    const arr = completedSteps[diagnosisId] || [];
    if (idx > arr.length) return;
    setCompletedSteps((prev) => {
      const current = prev[diagnosisId] || [];
      if (idx > current.length) return prev;
      return { ...prev, [diagnosisId]: idx < current.length ? current.slice(0, idx) : [...current, idx] };
    });
    recordEvent('Treatment plan', `Updated step ${idx + 1} for ${diagnosisId}`);
  }, [completedSteps, diagnosis, recordEvent]);

  const queueEarthPacket = useCallback((packet) => {
    setEarthQueue((current) => [...current, packet]);
    recordEvent('Earth alert', `Queued packet: ${packet.diagnosis || 'medical summary'}`);
  }, [recordEvent]);

  const queueEmergencyPacket = useCallback((packet) => {
    setEarthQueue((current) => [...current, packet]);
  }, []);

  const setLiveVitals = useCallback((readings) => {
    setLiveVitalsState(readings);
    if (readings) recordEvent('Vitals', `HR ${readings.hr ?? '—'}, BP ${readings.bpSys ? `${readings.bpSys}/${readings.bpDia}` : '—'}, SpO2 ${readings.spo2 ?? '—'}%, temperature ${readings.temp ?? '—'}°C`);
  }, [recordEvent]);

  const saveDeviceReading = useCallback(async (type, source, readings) => {
    if (!patient || isGuest) throw new Error('Sign in to a patient account to save device readings.');
    const result = await localApi('/device-readings', {
      method: 'POST',
      body: { type, source, readings },
    });
    setPatient((current) => current ? { ...current, deviceReadings: result.readings } : current);
    return result.reading;
  }, [patient, isGuest]);

  const saveAssessmentHistory = useCallback(async (assessment) => {
    if (!patient || isGuest) throw new Error('Sign in to a patient account to save assessment history.');
    const result = await localApi('/assessment-history', { method: 'POST', body: assessment });
    setPatient((current) => current ? { ...current, assessmentHistory: result.assessmentHistory } : current);
    return result.assessment;
  }, [patient, isGuest]);

  const loadInventory = useCallback(() => localApi('/inventory'), []);

  const saveWellnessEntry = useCallback(async (type, details) => {
    if (!patient || isGuest) throw new Error('Sign in to a patient account to save wellness history.');
    const result = await localApi('/wellness-entries', { method: 'POST', body: { type, details } });
    setPatient((current) => current ? { ...current, wellnessEntries: result.wellnessEntries } : current);
    return result.entry;
  }, [patient, isGuest]);

  const deleteWellnessEntry = useCallback(async (id) => {
    if (!patient || isGuest) throw new Error('Sign in to a patient account to edit wellness history.');
    const result = await localApi(`/wellness-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setPatient((current) => current ? { ...current, wellnessEntries: result.wellnessEntries } : current);
  }, [patient, isGuest]);

  const persistConditions = useCallback(async (conditions) => {
    if (!patient) return;
    const updated = await updateProfile({ ...patient, conditions });
    setPatient(updated);
  }, [patient, updateProfile]);

  const applyDiagnosisToCrew = useCallback((dx) => {
    if (!patient || !dx) return;
    const current = patient.conditions || [];
    if (current.some((condition) => condition.id === dx.id)) return;
    const condition = {
      id: dx.id,
      name: dx.name,
      severity: dx.severity,
      penalty: SEVERITY_PENALTY[dx.severity] ?? 5,
      date: Date.now(),
    };
    persistConditions([...current, condition]);
  }, [patient, persistConditions]);

  const resolveCrewCondition = useCallback((conditionId) => {
    if (!patient) return;
    persistConditions((patient.conditions || []).filter((condition) => condition.id !== conditionId));
  }, [patient, persistConditions]);

  const clearCrewConditions = useCallback((id) => {
    if (patient?.id === id) persistConditions([]);
  }, [patient, persistConditions]);

  const effectiveCrew = useMemo(() => patient ? [patient] : [], [patient]);
  const crew = patient;

  return (
    <MissionContext.Provider value={{
      session,
      sessionLoading,
      isGuest,
      patient,
      crew,
      crewId: patient?.id || null,
      effectiveCrew,
      createAccount,
      loginWithPin,
      loginWithPasskey,
      loginGuest,
      registerPasskey,
      updateProfile,
      changePin,
      logout,
      diagnosis,
      setDiagnosis: updateDiagnosis,
      completedSteps,
      toggleStep,
      temperatureUnit,
      setTemperatureUnit,
      settingsError,
      earthQueue,
      queueEarthPacket,
      queueEmergencyPacket,
      liveVitals,
      setLiveVitals,
      saveDeviceReading,
      saveAssessmentHistory,
      loadInventory,
      saveWellnessEntry,
      deleteWellnessEntry,
      recordEvent,
      applyDiagnosisToCrew,
      resolveCrewCondition,
      clearCrewConditions,
    }}>
      {children}
    </MissionContext.Provider>
  );
}
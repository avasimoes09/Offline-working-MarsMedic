import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMission } from '@/lib/MissionContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getIdleStage, IDLE_LOGOUT_MS, IDLE_WARNING_MS } from '@/lib/sessionInactivity';

const LOGIN_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/oauth/consent',
]);
const THROTTLED_ACTIVITY_EVENTS = new Set(['pointermove', 'scroll', 'wheel']);

export default function SessionInactivityGuard() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { sessionLoading, logout } = useMission();
  const [warningOpen, setWarningOpen] = useState(false);
  const lastActivityAt = useRef(Date.now());
  const warningTimer = useRef(null);
  const logoutTimer = useRef(null);
  const logoutStarted = useRef(false);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const clearTimers = useCallback(() => {
    window.clearTimeout(warningTimer.current);
    window.clearTimeout(logoutTimer.current);
    warningTimer.current = null;
    logoutTimer.current = null;
  }, []);

  const expireSession = useCallback(async () => {
    if (logoutStarted.current) return;
    logoutStarted.current = true;
    clearTimers();
    try {
      await logoutRef.current();
    } catch (error) {
      console.error('Unable to end the idle session cleanly:', error);
    } finally {
      setWarningOpen(false);
      navigate('/', { replace: true });
    }
  }, [clearTimers, navigate]);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    const elapsed = Date.now() - lastActivityAt.current;
    const stage = getIdleStage(elapsed);
    if (stage === 'logout') {
      void expireSession();
      return;
    }
    if (stage === 'warning') {
      setWarningOpen(true);
    } else {
      warningTimer.current = window.setTimeout(
        () => setWarningOpen(true),
        IDLE_WARNING_MS - elapsed,
      );
    }
    logoutTimer.current = window.setTimeout(
      () => { void expireSession(); },
      IDLE_LOGOUT_MS - elapsed,
    );
  }, [clearTimers, expireSession]);

  const noteActivity = useCallback((event) => {
    if (logoutStarted.current) return;
    const now = Date.now();
    if (THROTTLED_ACTIVITY_EVENTS.has(event?.type) && now - lastActivityAt.current < 1000) return;
    lastActivityAt.current = now;
    setWarningOpen(false);
    scheduleTimers();
  }, [scheduleTimers]);

  useEffect(() => {
    if (sessionLoading || LOGIN_PATHS.has(pathname)) {
      clearTimers();
      return undefined;
    }

    lastActivityAt.current = Date.now();
    logoutStarted.current = false;
    scheduleTimers();
    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, noteActivity, { passive: true });
    });
    const checkAfterVisibilityChange = () => {
      if (document.hidden) return;
      const stage = getIdleStage(Date.now() - lastActivityAt.current);
      if (stage === 'logout') void expireSession();
      else if (stage === 'warning') setWarningOpen(true);
    };
    document.addEventListener('visibilitychange', checkAfterVisibilityChange);
    return () => {
      clearTimers();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, noteActivity);
      });
      document.removeEventListener('visibilitychange', checkAfterVisibilityChange);
    };
  }, [pathname, sessionLoading, clearTimers, expireSession, noteActivity, scheduleTimers]);

  return (
    <AlertDialog
      open={warningOpen && !sessionLoading && !LOGIN_PATHS.has(pathname)}
      onOpenChange={(open) => {
        if (!open) noteActivity();
      }}
    >
      <AlertDialogContent className="border-slate-700 bg-slate-900 text-slate-100">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">
            You have been inactive for 90 seconds. M. I. A. will return to the login screen in 30 seconds.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => noteActivity()}
            className="bg-cyan-700 text-white hover:bg-cyan-600"
          >
            I'm still here
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const PASSKEY_CHALLENGE_MAX_AGE_MS = 4 * 60 * 1000;

export function createPasskeyOptionsPreloader(loadOptions, maxAgeMs = PASSKEY_CHALLENGE_MAX_AGE_MS) {
  let cachedEntry = null;

  const isFresh = (entry) => Date.now() - entry.startedAt < maxAgeMs;
  const preload = () => {
    if (cachedEntry && isFresh(cachedEntry)) return cachedEntry.promise;

    const entry = {
      startedAt: Date.now(),
      promise: Promise.resolve().then(loadOptions),
    };
    cachedEntry = entry;
    entry.promise.catch(() => {
      if (cachedEntry === entry) cachedEntry = null;
    });
    return entry.promise;
  };

  return {
    preload,
    consume() {
      const entry = cachedEntry;
      if (entry && isFresh(entry)) {
        cachedEntry = null;
        return entry.promise;
      }
      return preload();
    },
    clear() {
      cachedEntry = null;
    },
  };
}

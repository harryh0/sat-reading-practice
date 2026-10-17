import { useEffect, useState, useSyncExternalStore } from 'react'
import { PracticeSession } from './practiceSession.ts'

export function usePracticeSession() {
  const [session] = useState(() => new PracticeSession({ getStorage: () => window.localStorage }))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => { void session.loadSelected() }, [session])
  return { session, snapshot }
}

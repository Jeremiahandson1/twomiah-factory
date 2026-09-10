import { useAuth } from '../contexts/AuthContext'

/** Hook form of AuthContext.hasFeature for components that gate on one feature id. */
export function useFeature(featureId: string): boolean {
  return useAuth().hasFeature(featureId)
}

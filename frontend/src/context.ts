import { createContext, useContext } from 'react'

export interface ConfirmationRequest {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

export interface AppActions {
  notify: (message: string) => void
  confirm: (request: ConfirmationRequest) => void
}

export const AppActionsContext = createContext<AppActions | null>(null)

export function useAppActions() {
  const actions = useContext(AppActionsContext)
  if (!actions) throw new Error('useAppActions must be used inside AppActionsContext')
  return actions
}
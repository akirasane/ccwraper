import { create } from 'zustand'

// Open state of the palette. Lives outside the lazy CommandPalette chunk so the always-loaded
// key listener (PaletteTrigger) can open it before that chunk has finished loading.
interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open }))
}))

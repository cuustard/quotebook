/**
 * Lightweight global UI state (modals, mobile nav). Kept separate from data so
 * re-renders stay cheap.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A Quick Add capture being manually converted into a quote. */
export interface CaptureDraft {
  id: string;
  text: string;
  created_at: string;
}

interface QuoteModalState {
  open: boolean;
  quotebookId: string | null;
  /** When set, the modal edits an existing quote instead of creating one. */
  editQuoteId: string | null;
  /** When set, the modal creates a quote from this capture's raw text. */
  capture: CaptureDraft | null;
}

interface UIState {
  quoteModal: QuoteModalState;
  mobileNavOpen: boolean;
  sidebarCollapsed: boolean;

  openCreateQuote: (quotebookId: string) => void;
  openEditQuote: (quotebookId: string, quoteId: string) => void;
  openConvertCapture: (quotebookId: string, capture: CaptureDraft) => void;
  closeQuoteModal: () => void;

  setMobileNav: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      quoteModal: { open: false, quotebookId: null, editQuoteId: null, capture: null },
      mobileNavOpen: false,
      sidebarCollapsed: false,

      openCreateQuote: (quotebookId) =>
        set({ quoteModal: { open: true, quotebookId, editQuoteId: null, capture: null } }),
      openEditQuote: (quotebookId, quoteId) =>
        set({ quoteModal: { open: true, quotebookId, editQuoteId: quoteId, capture: null } }),
      openConvertCapture: (quotebookId, capture) =>
        set({ quoteModal: { open: true, quotebookId, editQuoteId: null, capture } }),
      closeQuoteModal: () =>
        set({ quoteModal: { open: false, quotebookId: null, editQuoteId: null, capture: null } }),

      setMobileNav: (open) => set({ mobileNavOpen: open }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "quotebook-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);

/**
 * Lightweight global UI state (modals, mobile nav). Kept separate from data so
 * re-renders stay cheap.
 */

import { create } from "zustand";

interface QuoteModalState {
  open: boolean;
  quotebookId: string | null;
  /** When set, the modal edits an existing quote instead of creating one. */
  editQuoteId: string | null;
}

interface UIState {
  quoteModal: QuoteModalState;
  mobileNavOpen: boolean;

  openCreateQuote: (quotebookId: string) => void;
  openEditQuote: (quotebookId: string, quoteId: string) => void;
  closeQuoteModal: () => void;

  setMobileNav: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  quoteModal: { open: false, quotebookId: null, editQuoteId: null },
  mobileNavOpen: false,

  openCreateQuote: (quotebookId) =>
    set({ quoteModal: { open: true, quotebookId, editQuoteId: null } }),
  openEditQuote: (quotebookId, quoteId) =>
    set({ quoteModal: { open: true, quotebookId, editQuoteId: quoteId } }),
  closeQuoteModal: () =>
    set({ quoteModal: { open: false, quotebookId: null, editQuoteId: null } }),

  setMobileNav: (open) => set({ mobileNavOpen: open }),
}));

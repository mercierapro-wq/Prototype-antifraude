import type { LegalMentionsResult } from '../controls/legalMentions';

// ─── Contrat API ──────────────────────────────────────────────────────────────

export interface CheckItem {
  id: string;
  name: string;
  desc: string;
  icon: string;
  status: 'pass' | 'warn' | 'fail';
}

export interface Finding {
  type: 'critical' | 'warning' | 'info';
  icon: string;
  title: string;
  detail: string;
}

export interface SubScores {
  /** Score structurel (mentions légales). 0-100, higher = riskier. */
  struct: number;
  /** Cohérence des calculs HT/TVA/TTC. Non implémenté — 0. */
  calc: number;
  /** Falsification visuelle / métadonnées. Non implémenté — 0. */
  visual: number;
  /** Détection doublons. Non implémenté — 0. */
  dup: number;
}

export interface AnalyzeResponse {
  /** Numéro de facture extrait */
  invoice_id: string;
  /** Raison sociale émetteur (heuristique) */
  company: string;
  /** Montant TTC détecté */
  amount: string;
  /** Nombre de pages du PDF */
  num_pages: number;
  /**
   * Score de risque global — 0 à 100, plus élevé = plus risqué.
   * Calculé comme 100 − legal_mentions.score (compliance).
   */
  risk_score: number;
  risk_level: 'high' | 'medium' | 'low';
  /** Résultats des 6 contrôles anti-fraude */
  checks: CheckItem[];
  sub_scores: SubScores;
  /** Signaux détectés (anomalies, avertissements, infos) */
  findings: Finding[];
  /** Détail complet du contrôle mentions légales */
  legal_mentions: LegalMentionsResult;
}

// ─── Définition statique des 6 contrôles ─────────────────────────────────────

export const CONTROL_DEFINITIONS: Omit<CheckItem, 'status'>[] = [
  { id: 'mentions',       name: 'Mentions légales obligatoires', desc: 'SIRET · N° TVA · Adresse · Date · N° facture', icon: '📋' },
  { id: 'calculs',        name: 'Cohérence des calculs',         desc: 'HT · TVA · TTC · Taux appliqués',              icon: '🔢' },
  { id: 'siret_insee',    name: 'Validation SIRET / INSEE',      desc: 'Existence · Activité · Statut juridique',      icon: '🏢' },
  { id: 'visuel',         name: 'Détection falsification visuelle', desc: 'Métadonnées · Altérations · Polices',       icon: '👁️' },
  { id: 'doublons',       name: 'Détection doublons',            desc: 'Hash document · Fingerprint · Cross-client',  icon: '🔁' },
  { id: 'comportemental', name: 'Analyse comportementale',       desc: 'Fréquence · Montants inhabituels · Patterns', icon: '📊' },
];

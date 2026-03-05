# CLAUDE.md — Finovox | Étude de cas Product Manager

## Contexte du projet

**Finovox** est une plateforme SaaS B2B de vérification automatique de documents (CNI, passeports, justificatifs de domicile, factures, etc.).

Un nouveau client — une **startup dans le secteur de l'assurance** — a été signé. Le besoin : renforcer les **contrôles anti-fraude sur les factures françaises** utilisées dans les parcours de remboursement et de gestion des sinistres.

---

## Objectifs business

| Priorité | Objectif |
|----------|----------|
| 🔴 Critique | Réduire les pertes financières liées à la fraude sur factures |
| 🔴 Critique | Renforcer la robustesse des contrôles spécifiques aux factures françaises |
| 🟠 Élevé | Améliorer la précision des signaux fraude (limiter les faux positifs) |
| 🟡 Moyen | Assurer une solution scalable sans dégradation des performances |

---

## Livrables attendus

- [ ] **One-pager** : présentation du cas d'usage business + contrôles à implémenter + plan de delivery
- [ ] **Résultats des tests** effectués sur les contrôles
- [ ] **Cartes développeurs** claires et actionnables

---

## Structure du projet

```
finovox-pm-case/
├── CLAUDE.md                  # Ce fichier — contexte et guidelines
├── one-pager/
│   ├── use-case-business.md   # Présentation du cas d'usage
│   ├── controles.md           # Contrôles anti-fraude à implémenter
│   └── plan-delivery.md       # Plan de delivery
├── dev-cards/
│   └── user-stories.md        # Cartes à destination des développeurs
└── tests/
    └── resultats-tests.md     # Résultats des tests et métriques
```

---

## Critères d'évaluation (ce qui sera jugé)

1. **Capacité de recherche** sur le cas d'usage (factures françaises, fraude documentaire)
2. **Clarté de rédaction** des cartes développeurs (user stories, critères d'acceptance)
3. **Choix des outils** utilisés et justification
4. **Démarche** et capacité à collaborer avec une équipe produit

---

## Guidelines de rédaction

### Pour les cartes développeurs
- Format : `En tant que [persona], je veux [action] afin de [bénéfice]`
- Toujours inclure les **critères d'acceptance** (Given / When / Then)
- Inclure les **cas limites** et les comportements attendus en cas d'erreur
- Mentionner les **dépendances** et les prérequis techniques

### Pour les contrôles anti-fraude
- Décrire le **signal détecté** (qu'est-ce qui est anormal ?)
- Indiquer la **méthode de détection** (OCR, ML, règle métier...)
- Préciser le **niveau de risque** : 🔴 Bloquant / 🟠 Suspect / 🟡 À vérifier
- Définir l'**action déclenchée** (rejet automatique, revue manuelle, flag...)

### Pour le plan de delivery
- Décomposer en **sprints ou milestones** clairs
- Identifier les **dépendances inter-équipes**
- Préciser les **indicateurs de succès** (KPIs, métriques de fraude)

---

## Domaine métier — Factures françaises

### Obligations légales (factures B2B françaises)
Les factures françaises doivent obligatoirement mentionner :
- Numéro de facture (séquentiel, unique)
- Date d'émission
- Identité et adresse du vendeur + numéro SIRET
- Identité et adresse de l'acheteur
- Description des produits/services
- Prix HT, taux de TVA, montant TVA, prix TTC
- Conditions de paiement et pénalités de retard
- Mention RCS si applicable

### Signaux de fraude courants sur les factures
- Numéro SIRET inexistant ou radié (vérifiable via API INSEE/Sirene)
- Incohérence entre SIRET et raison sociale
- Montants TVA incohérents avec le taux appliqué
- Métadonnées PDF révélatrices (date de création, logiciel utilisé)
- Polices ou mise en page non conformes au modèle de l'émetteur
- Numérotation non séquentielle
- Adresses ou coordonnées bancaires modifiées

---

## Stack & Outils suggérés

| Catégorie | Outil | Usage |
|-----------|-------|-------|
| OCR | Tesseract / Google Vision / AWS Textract | Extraction du texte |
| Vérification SIRET | API Sirene (INSEE) | Validation légale |
| Analyse PDF | PyMuPDF / pdfminer | Métadonnées & structure |
| Détection d'anomalies | Règles métier + scoring ML | Signaux fraude |
| Gestion des tickets | Jira / Linear | User stories & sprints |
| Documentation | Notion / Confluence | Spécifications produit |

---

## Définition of Done (DoD)

Un contrôle est considéré comme **livré** lorsque :
- ✅ La logique de détection est implémentée et testée
- ✅ Les critères d'acceptance sont validés en recette
- ✅ Le taux de faux positifs est mesuré et dans les seuils définis
- ✅ La documentation technique est à jour
- ✅ Le contrôle est activé en production pour le client assurance

---

## Contacts & Contexte équipe

- **Client** : Startup assurance (nom confidentiel)
- **Use cases client** : Remboursement sinistres, gestion des parcours de réclamation
- **Contrainte clé** : Ne pas dégrader l'UX avec des faux positifs excessifs
- **Scalabilité** : La solution doit tenir la montée en charge sans re-architecture

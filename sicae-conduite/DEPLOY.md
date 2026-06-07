# SICAE – Conduite GRD — Instructions de déploiement

## Prérequis

- Node.js 18+
- npm
- Compte [Netlify](https://netlify.com) (gratuit)
- Compte [Supabase](https://supabase.com) (gratuit)
- Netlify CLI : `npm install -g netlify-cli`

---

## Étape 1 — Créer la base de données Supabase

1. Aller sur [supabase.com](https://supabase.com) → **New project**
2. Choisir un nom, mot de passe, région (ex : *West EU*)
3. Attendre la création (~1 min)
4. Aller dans **SQL Editor** → **New query**
5. Coller le contenu de `supabase/schema.sql` → **Run**
6. Récupérer les credentials dans **Settings → API** :
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (⚠️ pas la anon key) → `SUPABASE_SERVICE_KEY`

---

## Étape 2 — Installer les dépendances

```bash
cd sicae-conduite
npm install
```

---

## Étape 3 — Créer le site Netlify

```bash
netlify init
```

Choisir :
- **Create & configure a new site**
- Sélectionner votre équipe Netlify
- Donner un nom au site (ex : `sicae-conduite`)

---

## Étape 4 — Configurer les variables d'environnement

```bash
netlify env:set SUPABASE_URL "https://xxxx.supabase.co"
netlify env:set SUPABASE_SERVICE_KEY "eyJ..."
```

Pour un test local, créer un fichier `.env` à la racine (ne jamais committer ce fichier) :

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

---

## Étape 5 — Tester en local

```bash
npm run dev
# ou directement :
netlify dev
```

Ouvrir [http://localhost:8888](http://localhost:8888)

---

## Étape 6 — Déployer en production

```bash
npm run deploy
# ou :
netlify deploy --prod
```

Netlify affiche l'URL de production (ex : `https://sicae-conduite.netlify.app`).

---

## Étape 7 — Vérification

1. Ouvrir l'URL Netlify
2. Aller dans **Nouvelle intervention** → créer un test
3. Vérifier dans **Tableau de bord** que le compteur s'incrémente
4. Vérifier dans **Historique** que la card apparaît
5. Clôturer l'intervention → statut doit passer à "Terminée"
6. Aller dans **Paramètres** → télécharger une sauvegarde

---

## Notes de sécurité

- La `SUPABASE_SERVICE_KEY` est une clé avec privilèges admin. Elle ne doit jamais être exposée côté frontend.
- Elle est utilisée uniquement dans les Netlify Functions (server-side).
- Activer les **Row Level Security (RLS)** dans Supabase si l'application doit être multi-utilisateur avec authentification.

---

## Structure des fichiers

```
sicae-conduite/
├── netlify.toml                  # Config Netlify (publish + redirects API)
├── package.json                  # Dépendance @supabase/supabase-js
├── .env.example                  # Modèle de variables d'env
├── DEPLOY.md                     # Ce fichier
├── supabase/
│   └── schema.sql                # Script SQL à exécuter dans Supabase
├── public/
│   ├── index.html                # Application SPA
│   ├── style.css                 # Styles (thème SICAE)
│   └── app.js                   # Logique frontend vanilla JS
└── netlify/
    └── functions/
        ├── interventions.js      # CRUD interventions
        ├── listes.js             # CRUD listes déroulantes
        └── backup.js             # Export / Import JSON
```

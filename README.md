<div align="center">

# 🗺️ Paris Travel Time

**Carte isochrone des transports en commun d'Île-de-France.**
Cliquez n'importe où : la carte se colore selon le temps de trajet réel, vers les 36 000 arrêts du réseau, en ~15 millisecondes.

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![numba](https://img.shields.io/badge/numba-JIT-00A3E0)
![GTFS](https://img.shields.io/badge/GTFS-g%C3%A9n%C3%A9rique-orange)

<img src="docs/hero.png" alt="Heatmap depuis Châtelet à 8h30" width="85%"/>

*Depuis Châtelet un mardi à 8h30 — vert < 15 min, jaune < 30, orange < 45, rouge < 60.*

</div>

---

## ✨ Fonctionnalités

- 🎯 **Un clic = un heatmap** — temps de trajet vers tout le réseau (métro, RER, Transilien, tram, bus des 75 opérateurs IDFM), correspondances et marche comprises
- 🤝 **Mode rencontre** — avec plusieurs marqueurs, basculez d'« atteignable par *l'un* de nous » (union) à « où peut-on *tous* se retrouver rapidement » (max des temps)
- 🎬 **Animation de la journée** — un bouton ▶ fait défiler l'heure de départ de 5h à minuit : le réseau respire au rythme des fréquences
- 🚇 **Filtres par mode** — métro / RER-train / tram / bus, combinables ("et si je n'avais pas le bus ?")
- 🧭 **Itinéraire au clic droit** — le détail du trajet le plus rapide vers n'importe quel point : lignes, horaires, correspondances, minutes de marche
- ⏰ **Heure de départ libre** + bornes de couleur ajustables (les sliders ne refont *aucun* appel réseau)
- 🔗 **URL partageable** — toute la vue (marqueurs, heure, bornes, modes) vit dans l'URL
- 🔍 Recherche d'adresse (Nominatim/OSM)

<div align="center">
<img src="docs/features.png" alt="Mode rencontre, filtres et itinéraire" width="85%"/>

*Mode rencontre à deux marqueurs, sans bus, itinéraire détaillé au clic droit.*
</div>

## ⚙️ Comment ça marche

1. **Ingestion** (one-shot, ~40 s) — le [flux GTFS d'Île-de-France Mobilités](https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/) (129 Mo) est compilé en tableaux numpy : **2,97 M de connexions** triées par heure de départ + un graphe piéton de 208 k arêtes (correspondances officielles, gares multi-quais, arrêts à < 200 m).
2. **Requête** — le [Connection Scan Algorithm](https://arxiv.org/abs/1703.05997) balaie les connexions en un seul passage. Compilé par numba : **~15 ms** pour un *one-to-all* complet, prédécesseurs compris (d'où les itinéraires gratuits).
3. **Rendu** — un cercle canvas par arrêt atteint, de rayon `80 m/min × minutes restantes de la bande` : la distance encore parcourable à pied. ~28 000 cercles opaques dans un *pane* Leaflet à 40 % d'opacité (la transparence par couche, jamais par cercle — sinon l'empilement sature).

Le backend est **100 % GTFS générique** : aucune ligne de code spécifique à Paris. Une autre ville = un autre zip GTFS.

## 🚀 Lancer en local

**Prérequis** : Python ≥ 3.12, Node ≥ 20.

```powershell
# Backend (terminal 1)
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m ingest.download_gtfs                                    # ~129 Mo
.\.venv\Scripts\python -m ingest.build_network --gtfs data/gtfs/IDFM-gtfs.zip --date 2026-06-16
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

> 💡 Choisissez comme `--date` un jour de semaine dans les 30 prochains jours (le flux IDFM est glissant). Pour une autre ville : `download_gtfs --url <gtfs.zip>`.

**Vérifier** : `pytest` (9 tests du kernel), `python -m scripts.query_cli --from 48.8588,2.3470 --at 08:30 --to "Defense"`, et `node smoke.mjs` / `node smoke-interactions.mjs` (smoke tests Playwright de l'app complète).

## 📡 API

| Endpoint | Description |
|---|---|
| `GET /health` | statut, date de service, tailles du réseau |
| `GET /stops` | catalogue des arrêts (tableaux parallèles, ~533 ko gzip, mis en cache 24 h) |
| `GET /traveltime?from=48.85,2.34&at=08:30&max=100` | `{idx[], minutes[]}` — `from` répétable (≤ 4) ; `mode=union\|meet` ; `modes=metro,rail,tram,bus` |
| `GET /route?from=…&to=48.89,2.24&at=08:30` | itinéraire détaillé vers un point : étapes, lignes, horaires |

## 📊 Performances mesurées

| Étape | Mesure |
|---|---|
| Prétraitement GTFS complet | 37 s |
| Requête CSA à chaud (2,97 M connexions, one-to-all) | **13–35 ms** |
| Réponse `/traveltime` (~28 500 arrêts, gzip) | 110 ko |
| Rendu de ~28 000 cercles (canvas) | 100–300 ms |

## 📚 Pour aller plus loin

- [`docs/rapport.pdf`](docs/rapport.pdf) — rapport technique complet (11 pages) : rétro-ingénierie de l'application originale, algorithme, choix d'architecture, mesures.
- Pistes v2 : vraies isochrones (graphe piéton OSM), multi-villes (Mobility Database), temps réel (SIRI/PRIM).

## 🙏 Crédits

Inspiré de [London Travel Time](https://tflmap.onrender.com/) de Jonas Scholz (concept rétro-analysé, code intégralement réécrit).
Données : [Île-de-France Mobilités](https://prim.iledefrance-mobilites.fr/) (ODbL) · Fonds de carte : [CARTO](https://carto.com/) / [OpenStreetMap](https://www.openstreetmap.org/copyright) · Géocodage : [Nominatim](https://nominatim.org/).

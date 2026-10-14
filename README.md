# Proyección de gasto médico mensual (Q×P) — demo con datos sintéticos

Tablero gerencial que estima el fondo de contingencia del mes siguiente para una obra social **ficticia**: cantidad proyectada por práctica (Random Forest) × arancel por convenio. **Todos los valores son sintéticos de demostración.**

![stack](https://img.shields.io/badge/Python-pandas%20%7C%20scikit--learn%20%7C%20DuckDB-blue) ![frontend](https://img.shields.io/badge/Frontend-HTML%20%2B%20JS%20%2B%20Plotly-green)

## Ver la demo
- **En tu PC:** doble clic en `index.html` (pide internet para Chart.js, Plotly y Google Fonts).
- **Online:** link de deploy (ver abajo) o publicala gratis con GitHub Pages/Netlify.

## Qué muestra
6 pestañas (Resumen, Modelo, Prácticas, Mapa, Clusters, Padrón): hero con gasto proyectado, precisión del modelo (MAPE), curva por práctica, mapa por provincia ($ por socio), clusters de prácticas y evolución del padrón.

## Cómo está construido (resumen de arquitectura)

Pipeline en Python (código privado): eventos sintéticos generados por script (36 meses, ~16,7M filas, seed fija) → DuckDB como fuente única → agregado mensual por SQL → Random Forest (MAPE ~4,7%) → K-means + PCA para clusters → payloads `data/*.js` que consume el tablero. El frontend solo muestra, no calcula.

## Privacidad
Ningún dato real: convenios, entidades, padrón y aranceles son ficticios generados por script (seed 42). La base DuckDB y los Parquet no se suben al repo (ver `.gitignore`).

Autor: Rodrigo Carlini — Data Analyst (salud, Power BI, SQL, Python).

# MotoLog (PWA) — Gestão + Trajetos

App web **mobile-first** para uso pessoal (offline-first) que registra:
- **Jornadas** (iniciar/parar) e o **trajeto** no mapa (OpenStreetMap + Leaflet).
- **Ganhos e despesas** (financeiro) com resumos e KPIs.
- **Backup** (exportar/importar JSON) e **CSV** do financeiro.

> Funciona melhor como **PWA instalado** no Android.

## 1) Como rodar localmente (PC)

### Opção A (recomendada): servidor HTTP simples
1. Abra o terminal dentro da pasta do projeto.
2. Rode:
   - **Python**: `python -m http.server 5173`
   - ou **Node**: `npx serve -l 5173`
3. Acesse no navegador:
   - `http://localhost:5173` (ou `http://localhost:5173/motolog` se você estiver servindo a pasta pai)

> Não abra via `file://` (alguns recursos como Service Worker / IndexedDB podem falhar).

## 2) Como usar no celular (Android / Xiaomi Mi 9 SE)

### 2.1 Abrir no celular
- Coloque o projeto em algum lugar acessível via rede (por exemplo, no seu PC) e acesse o endereço pelo celular.
- Alternativa: faça **deploy no Vercel** (abaixo).

### 2.2 Instalar como PWA
No **Chrome Android**:
1. Acesse o site do app.
2. Menu (⋮) → **“Adicionar à tela inicial”** ou **“Instalar app”**.
3. Abra pelo ícone instalado.

### 2.3 Permissões e baterias (IMPORTANTE para GPS)
O Android pode pausar o GPS em segundo plano. Para registrar melhor:
1. Instale como PWA.
2. Durante a jornada, **mantenha o app aberto**.
3. No Xiaomi/MIUI:
   - Configurações → Bateria → **Economia de bateria em apps** → encontre o navegador/PWA → **Sem restrições**.
   - Configurações → Apps → Permissões → Localização → **Permitir sempre** (se disponível) ou **Permitir ao usar o app**.
4. No app, use **“Manter tela ativa”** (Wake Lock) quando disponível.

> Mesmo com ajustes, alguns aparelhos/roms podem interromper a captura se a tela desligar por muito tempo.

## 3) Deploy no Vercel

1. Crie um repositório (GitHub) com esta pasta.
2. No Vercel: New Project → selecione o repo.
3. Framework preset: **Other**.
4. Build command: **vazio** (ou `npm run build` se você criar um build no futuro).
5. Output directory: **.**
6. Deploy.

### Observação sobre HTTPS
Geolocalização exige contexto seguro:
- `https://...` (Vercel serve HTTPS automaticamente) ou
- `http://localhost`.

## 4) Backup e restauração

- **Exportar JSON**: Ajustes → Backup → Exportar JSON.
- **Importar JSON**: Ajustes → Backup → Importar JSON.
  - Você pode escolher **Mesclar** (mantém os dados atuais e adiciona os novos) ou **Substituir** (apaga tudo e restaura do arquivo).
- **CSV** (Financeiro): Financeiro → Exportar CSV.

## 5) Limitações conhecidas
- **Tiles do mapa (OSM)** precisam de internet. O app funciona offline para interface e dados, mas o mapa pode aparecer sem fundo quando offline.
- Captura de GPS em segundo plano pode ser limitada por economia de bateria.

## 6) Estrutura do projeto
- `index.html` UI
- `styles.css` estilos
- `sw.js` service worker
- `src/db.js` IndexedDB
- `src/geo.js` GPS + filtros + cálculos
- `src/reports.js` resumos e KPIs
- `src/ui.js` helpers UI e mapa
- `src/app.js` orquestração (jornadas, financeiro, backup)


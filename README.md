#                              NO LONGER MAINTAINED
## USE [MEOWLY](https://github.com/utkarshgupta188/meowly)


# MeowTV 🎬🐱

**A modern, mobile-first streaming platform for Movies, TV Shows, Anime & Cartoons**

[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Live](https://img.shields.io/badge/Live-meowtv.vercel.app-brightgreen)](https://meowtv.vercel.app)

---

## 🚀 Overview

**MeowTV** is a Next.js streaming platform with support for multiple content providers. Stream anime, cartoons, and TV shows with a clean, Netflix-inspired UI that works beautifully on both desktop and mobile.

🌐 **Live:** [meowtv.vercel.app](https://meowtv.vercel.app)

---

## ✨ Features

- 🔀 **Multi-provider support** — Switch between streaming sources on the fly
- 📱 **Fully mobile-responsive** — Optimized for phones, tablets, and desktops
- 🎬 **Vidstack video player** — HLS streaming with quality selection, subtitles & audio tracks
- ⏩ **Seek controls** — Double-tap left/right to seek ±10s, or use the on-screen seek buttons
- 🔍 **Search** — Full-text search across all available content
- 🎞️ **Hero rotator** — Auto-rotating featured content with smooth transitions
- 📺 **Episode navigation** — Season/episode switching with persistent state
- ⚡ **Smart navbar** — Hides on scroll, reappears on scroll-up
- 🌙 **Dark mode** — Glassmorphism design system throughout

---

## 🛠️ Tech Stack

| Category      | Technology                              |
|---------------|----------------------------------------|
| **Framework** | Next.js 15 (App Router, Server Actions) |
| **Language**  | TypeScript 5                            |
| **Player**    | Vidstack React + hls.js                 |
| **Styling**   | Vanilla CSS (custom design system)      |
| **Deployment**| Vercel                                  |

---

## 📦 Quick Start

```bash
# 1. Clone
git clone https://github.com/utkarshgupta188/meowtv.git
cd meowtv/web 

# 2. Install
npm install

# 3. Environment
cp .env.example .env.local
# Fill in your provider API keys

# 4. Dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — done.

---

## 📁 Project Structure

```
web/src/
├── app/
│   ├── actions.ts          # Server actions (stream fetching)
│   ├── api/
│   │   ├── hls/            # HLS proxy
│   │   └── proxy/          # Content proxy
│   ├── layout.tsx           # Root layout + navbar + footer
│   ├── page.tsx             # Home page
│   ├── search/              # Search results
│   ├── watch/[id]/          # Watch page
│   └── globals.css          # Global styles + design system
├── components/
│   ├── VideoPlayer.tsx      # Vidstack player + seek overlay + quality menu
│   ├── WatchClient.tsx      # Client wrapper for watch page
│   ├── SmartNavbar.tsx      # Scroll-aware navbar
│   ├── HeroRotator.tsx      # Featured content rotator
│   ├── Card.tsx             # Content card
│   ├── SearchBar.tsx        # Search input
│   ├── ProviderSwitcher.tsx # Provider switcher dropdown
│   └── SeasonSwitcher.tsx   # Season/episode selector
└── lib/
    ├── api.ts               # Provider facade
    └── providers/           # Provider implementations
        ├── castletv.ts
        ├── xon.ts
        └── ...
```

---

## 🔧 Adding a New Provider

1. Create `src/lib/providers/myprovider.ts`
2. Implement the `Provider` interface:

```typescript
import { Provider } from './types';

export const MyProvider: Provider = {
    name: 'MyProvider',
    async fetchHome(page) { /* ... */ },
    async search(query) { /* ... */ },
    async fetchDetails(id) { /* ... */ },
    async fetchStream(movieId, episodeId, languageId) { /* ... */ },
};
```

3. Register it in `src/lib/api.ts`

---

## 🗺️ Roadmap

| Feature | Status |
|---------|--------|
| Multi-provider support | ✅ Done |
| Mobile responsiveness | ✅ Done |
| Vidstack player + quality selection | ✅ Done |
| Double-tap seek + seek buttons | ✅ Done |
| Subtitle support | ✅ Done |
| User accounts / watch history | 🚧 Planned |
| More providers | 🔄 Ongoing |

---

## 📝 License

MIT — see [LICENSE](LICENSE).

---

Made with 💚 by [Utkarsh Gupta](https://github.com/utkarshgupta188)

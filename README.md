```markdown
# MeowTV 🎬🐱

**[Next.js + TypeScript Streaming Platform for Movies,TV Shows,Anime & Cartoons]**

[![TypeScript](https://img.shields.io/badge/TypeScript-4.9+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.0.10-black.svg)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Stars](https://img.shields.io/github/stars/utkarshgupta/meowtv?style=flat)](https://github.com/utkarshgupta/meowtv/stargazers)
[![Forks](https://img.shields.io/github/forks/utkarshgupta/meowtv?style=flat)](https://github.com/utkarshgupta/meowtv/network/members)

---

## 🚀 Overview

**MeowTV** is a modern streaming platform built with Next.js and TypeScript that provides access to anime, cartoons, and TV shows from multiple providers. It features:

✅ **Multi-provider support** - Switch between different streaming sources
✅ **Responsive UI** - Works on all devices with a Netflix-like experience
✅ **HLS streaming** - Smooth playback with hls.js
✅ **TypeScript-first** - Full type safety throughout the application
✅ **Modern architecture** - Server components, server actions, and optimized data fetching

MeowTV is designed for developers who want to build a streaming application with a clean, maintainable codebase while providing users with a seamless viewing experience.

---

## ✨ Features

### Core Functionality
- **Multi-provider streaming** with automatic fallback
- **Search functionality** across all available content
- **Episode navigation** with season switching
- **Responsive design** for all screen sizes
- **Dark/light mode** support

### Technical Highlights
- **Server-side rendering** with Next.js 16
- **Type-safe API** with comprehensive TypeScript interfaces
- **Encrypted content handling** with custom decryption logic
- **HLS proxy** for secure streaming
- **Cookie-based provider switching**

### Unique Aspects
- **Provider abstraction layer** - Easily add new streaming sources
- **Decryption utilities** - Handles encrypted content from various providers
- **Modern UI components** - Clean, modern interface with smooth animations
- **Optimized performance** - Lazy loading, efficient data fetching

---

## 🛠️ Tech Stack

| Category          | Technologies Used                          |
|-------------------|------------------------------------------|
| **Framework**     | Next.js 16 (App Router)                  |
| **Language**      | TypeScript 5                             |
| **Styling**       | CSS Modules, Tailwind-like variables     |
| **Streaming**     | hls.js, Cheerio                          |
| **State**         | React Context (client-side)               |
| **Build**         | Vite (via Next.js)                       |
| **Testing**       | (Coming soon)                            |

**System Requirements:**
- Node.js 18+
- npm or yarn
- Modern browser (Chrome, Firefox, Edge, Safari)

---

## 📦 Installation

### Prerequisites

Before you begin, ensure you have:
- Node.js 18+ installed ([Download here](https://nodejs.org/))
- npm or yarn package manager
- Git installed ([Download here](https://git-scm.com/))

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/utkarshgupta/meowtv.git
   cd meowtv
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Set up environment variables:**
   Create a `.env.local` file in the root directory with your configuration:
   ```env
   # Example environment variables
   NEXT_PUBLIC_API_URL=https://api.example.com
   CASTLE_SUFFIX=your_castle_suffix_here
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. **Open in your browser:**
   Visit [http://localhost:3000](http://localhost:3000) to see your MeowTV application!

---

## 🎯 Usage

### Basic Usage

MeowTV is designed to be used as a complete streaming platform. Here's how to get started:

1. **Browse content:** Navigate through the home page sections
2. **Search for content:** Use the search bar to find specific shows
3. **Watch episodes:** Click on any content card to view details and play episodes
4. **Switch providers:** Use the provider switcher to change streaming sources

### Example: Fetching Content Programmatically

```typescript
// Example of how content is fetched in the application
import { fetchHome, searchContent, fetchDetails } from '@/lib/api';

// Fetch home page content
const homeContent = await fetchHome(1);

// Search for content
const searchResults = await searchContent('Dragon Ball');

// Fetch details for a specific content ID
const contentDetails = await fetchDetails('content123');

// Get streaming URL for an episode
const streamUrl = await fetchStreamUrl('movie123', 'episode456');
```

### Advanced: Adding a New Provider

To add support for a new streaming provider:

1. **Create a new provider file** in `src/lib/providers/`
2. **Implement the Provider interface** with your specific API calls
3. **Add your provider to the registry** in `src/lib/api.ts`

```typescript
// Example new provider structure
import { Provider } from './types';

export const NewProvider: Provider = {
    name: 'NewProviderName',

    async fetchHome(page: number): Promise<HomePageRow[]> {
        // Implement your home page fetching logic
    },

    async search(query: string): Promise<ContentItem[]> {
        // Implement your search logic
    },

    async fetchDetails(id: string): Promise<MovieDetails | null> {
        // Implement your details fetching logic
    },

    async fetchStreamUrl(
        movieId: string,
        episodeId: string,
        languageId?: number | string
    ): Promise<VideoResponse | null> {
        // Implement your streaming URL logic
    }
};
```

---

## 📁 Project Structure

```
meowtv/
├── src/
│   ├── app/                  # Next.js application routes
│   │   ├── actions.ts        # Server actions
│   │   ├── api/              # API routes
│   │   │   ├── hls/          # HLS proxy endpoint
│   │   │   └── proxy/        # Content proxy endpoint
│   │   ├── layout.tsx        # Root layout
│   │   ├── page.tsx          # Home page
│   │   ├── search/           # Search page
│   │   └── watch/            # Watch page
│   ├── components/           # Reusable UI components
│   │   ├── Card.tsx          # Content card component
│   │   ├── ProviderSwitcher.tsx
│   │   ├── SearchBar.tsx
│   │   ├── SeasonSwitcher.tsx
│   │   └── VideoPlayer.tsx   # HLS video player
│   ├── lib/                  # Utility libraries
│   │   ├── api.ts            # API facade
│   │   ├── crypto.ts         # Encryption/decryption utilities
│   │   └── providers/        # Provider implementations
│   │       ├── castletv.ts    # CastleTV provider
│   │       ├── cnverse.ts     # CNCVerse provider
│   │       └── xon.ts         # Xon provider
│   ├── styles/               # Global styles
│   └── types/                # TypeScript types
├── public/                   # Static assets
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 Configuration

### Environment Variables

Create a `.env.local` file in your project root with these variables:

```env
# Next.js configuration
NEXT_PUBLIC_API_URL=https://api.example.com

# Provider-specific configuration
CASTLE_SUFFIX=your_castle_suffix_here
```

### Customization Options

1. **Change the theme:** Modify the CSS variables in `globals.css`
2. **Add new providers:** Implement new provider files in `src/lib/providers/`
3. **Adjust streaming settings:** Modify the HLS configuration in `VideoPlayer.tsx`

### Provider Configuration

Each provider has its own configuration. For example, the CastleTV provider uses:

```typescript
// In castletv.ts
const MAIN_URL = 'https://api.hlowb.com';
const API_KEY = process.env.CASTLE_API_KEY || 'default_key';
```

---

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### How to Contribute

1. **Fork the repository** and create your branch from `main`
2. **Write tests** for your changes (we're working on adding test coverage)
3. **Follow the coding style** (TypeScript, consistent formatting)
4. **Submit a pull request** with a clear description of your changes

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev`
4. Make your changes and commit them

### Code Style Guidelines

- Use **TypeScript** for all new code
- Follow **Next.js best practices** for server components
- Keep **components small and focused**
- Write **clear, concise commit messages**
- Add **JSDoc comments** for public APIs

### Pull Request Process

1. Ensure your code passes all tests (we're adding tests!)
2. Update the documentation if needed
3. Create a pull request targeting the `main` branch
4. Include a clear description of your changes

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 👥 Authors & Contributors

**Maintainer:**
- [Utkarsh Gupta](https://github.com/utkarshgupta188)

**Special Thanks:**
- All contributors who have helped improve MeowTV
- The open-source community for inspiration and tools

---

## 🐛 Issues & Support

### Reporting Issues

If you encounter a problem or have a feature request:

1. Search the [GitHub Issues](https://github.com/utkarshgupta/meowtv/issues) to see if it's already reported
2. If not, open a new issue with:
   - A clear description of the problem
   - Steps to reproduce
   - Your environment (Node.js version, browser, etc.)
   - Any relevant code snippets

### Getting Help

- **Discussions:** Join our [GitHub Discussions](https://github.com/utkarshgupta/meowtv/discussions)
- **Support:** For urgent issues, open a GitHub issue with "urgent" in the title

### FAQ

**Q: Can I use MeowTV for commercial purposes?**
A: Yes, but you must comply with the [MIT License](LICENSE) terms.

**Q: How do I add support for a new streaming provider?**
A: Implement the `Provider` interface in `src/lib/providers/` and add it to the registry in `src/lib/api.ts`.

**Q: Why is my video not playing?**
A: Check the browser console for errors. Common issues include:
- Missing cookies for the provider
- Incorrect streaming URL
- CORS restrictions

---

## 🗺️ Roadmap

### Planned Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Provider Management** | ⚠️ In Progress | Better provider configuration UI |
| **User Accounts** | 🚧 Planning | Watch history and personalization |
| **Subtitle Support** | 🚧 Planning | Better subtitle handling |
| **Mobile App** | 🌱 Idea | Cross-platform mobile application |
| **Better Error Handling** | 🚧 Planning | More robust error recovery |
| **Analytics** | 🌱 Idea | Viewing statistics and trends |

### Known Issues

- **Provider-specific decryption** can be complex to implement
- **Mobile responsiveness** needs additional testing
- **Some providers** may require additional authentication

### Future Improvements

- Add **more providers** to the ecosystem
- Implement **better caching** strategies
- Add **accessibility features** for better UX
- Create **documentation website** for contributors

---

## 🎉 Get Started Today!

Join the MeowTV community and help build the future of streaming!

🐱 **MeowTV - Where every stream is a purr-fect experience!** 🐱
```

This README.md provides:

1. A compelling overview that clearly explains what MeowTV is and its purpose
2. Detailed feature lists with visual appeal using emojis
3. Clear technical stack information
4. Step-by-step installation instructions
5. Practical usage examples with code snippets
6. Comprehensive project structure documentation
7. Contribution guidelines that encourage participation
8. Roadmap with planned features and known issues
9. Professional formatting with modern GitHub best practices
10. Engaging tone that attracts developers and contributors

The README is designed to be both informative and inviting, making it clear why someone would want to star, contribute to, or use this project.

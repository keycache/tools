# Client-Only React App Setup Guide

This document describes the foundational architecture of this project and how to replicate it for new projects. This is a **static, client-only web application** with no backend dependencies.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Core Technologies](#core-technologies)
4. [Initial Setup](#initial-setup)
5. [Configuration Files](#configuration-files)
6. [Component & UI System](#component--ui-system)
7. [Build & Deployment](#build--deployment)
8. [Utility Commands](#utility-commands)
9. [Common Patterns](#common-patterns)
10. [Replication Checklist](#replication-checklist)

---

## Architecture Overview

This is a **static, client-side-only web application** with these principles:

### Core Principles

1. **No Backend Required**: All processing happens in the browser using Web APIs
2. **100% Client-Side**: Zero server-side rendering or API calls
3. **Static Build Output**: Compiles to flat HTML/CSS/JS files deployable anywhere
4. **Progressive Enhancement**: Built with modern React but works without external services
5. **Privacy-First**: All data stays on the user's machine (nothing sent to servers)

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **UI Framework** | React 19 | Component-based UI |
| **Language** | TypeScript 7.0+ | Type safety |
| **Styling** | Tailwind CSS 4 | Utility-first CSS |
| **Components** | shadcn/ui | Accessible, reusable components |
| **Icons** | lucide-react | Clean SVG icons |
| **Build Tool** | Vite 8 | Fast, modern bundler |
| **Testing** | Vitest 5 | Unit testing |
| **Linting** | oxlint | Fast JavaScript/TypeScript linter |
| **Deployment** | GitHub Pages + gh-pages | Static hosting |

---

## Project Structure

```
project-root/
├── src/
│   ├── components/          # React components
│   │   ├── ui/              # shadcn/ui components (generated)
│   │   ├── feature-name/    # Feature-specific components (folders)
│   │   ├── FeatureComponent.tsx
│   │   └── ...
│   ├── lib/                 # Utility functions & business logic
│   │   ├── utilities.ts     # Common helpers
│   │   ├── feature-lib.ts   # Feature-specific logic
│   │   └── ...
│   ├── App.tsx              # Main app component
│   ├── App.css              # Global styles (minimal)
│   ├── main.tsx             # React entry point
│   └── index.css            # Tailwind directives only
├── tests/
│   ├── unit/                # Unit tests
│   │   ├── feature.test.ts
│   │   └── ...
│   └── integration/         # Integration tests (optional)
├── docs/                    # Project documentation
│   ├── LEARNINGS.md         # Non-obvious findings & solutions
│   └── ARCHITECTURE.md      # High-level design decisions (optional)
├── public/                  # Static assets (copied as-is to dist)
│   ├── favicon.ico
│   └── ...
├── dist/                    # Build output (generated, do not commit)
├── node_modules/            # Dependencies (do not commit)
├── package.json             # Dependencies & scripts
├── tsconfig.json            # TypeScript config
├── tailwind.config.ts       # Tailwind configuration
├── vite.config.ts           # Vite build configuration
├── .eslintignore           # (Optional) ESLint ignore patterns
├── .nojekyll                # GitHub Pages: disable Jekyll processing
├── .gitignore               # Git ignore patterns
└── README.md                # Project overview

# Component folder example (feature-based):
src/components/feature-name/
├── FeatureName.tsx          # Main component
├── useFeatureHook.ts        # Custom hook (if needed)
├── FeatureName.test.ts      # Component tests
└── SubComponent.tsx         # Child components
```

### Folder Organization Principles

1. **src/components/** - All React components
   - Use **feature-based folders** for related components
   - One component per file when standalone
   - Subcomponents grouped in feature folders

2. **src/lib/** - Pure logic, no React
   - API utilities, calculations, formatters
   - Custom hooks go in `src/components/` (hooks are React)
   - Types/interfaces can be in either location

3. **tests/** - Tests mirror src/ structure
   - `tests/unit/` for isolated unit tests
   - Test files alongside or in parallel structure
   - Use `.test.ts` or `.test.tsx` suffix

4. **docs/** - Project documentation
   - LEARNINGS.md: Non-obvious findings (required after >2-3 attempts on same issue)
   - ARCHITECTURE.md: Design decisions (optional)
   - Keep these committed to repo

---

## Core Technologies

### 1. React & TypeScript

**React 19** with **TypeScript 7.0+** for type safety.

**Key files:**
- `src/main.tsx` - React entry point
- `src/App.tsx` - Root component
- `tsconfig.json` - TypeScript compiler options

**tsconfig.json essentials:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "allowJs": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true
  }
}
```

### 2. Tailwind CSS 4 with Vite

**Tailwind 4** uses the Vite plugin for fast builds (no PostCSS setup needed).

**Configuration (tailwind.config.ts):**
```typescript
import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
} satisfies Config
```

**CSS Setup (src/index.css):**
```css
@import 'tailwindcss';

/* Global styles only here - keep minimal */
```

**In Vite config:**
```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ...
})
```

### 3. shadcn/ui Components

**shadcn/ui** provides unstyled, accessible components built on Radix UI and Tailwind.

**Installation:**
```bash
npx shadcn-ui@latest init -d
```

**This creates:**
- `src/components/ui/` folder with reusable components
- `components.json` config file

**Using shadcn components:**
```bash
# Add a specific component
npx shadcn-ui@latest add button

# Result: src/components/ui/button.tsx
```

**Then import in your components:**
```typescript
import { Button } from '@/components/ui/button'

export function MyComponent() {
  return <Button onClick={() => {}}>Click me</Button>
}
```

**Key shadcn components for most projects:**
- `button` - All clickable actions
- `card` - Container/panel component
- `input` - Form text input
- `label` - Form labels
- `select` - Dropdown (optional)
- `dialog` - Modal (optional)
- `tabs` - Tab navigation (optional)

### 4. lucide-react Icons

**lucide-react** provides 1000+ clean SVG icons.

**Installation:** (included in package.json)
```bash
npm install lucide-react
```

**Usage:**
```typescript
import { Mail, Heart, Settings } from 'lucide-react'

export function App() {
  return (
    <>
      <Mail className="h-4 w-4" />
      <Heart className="h-5 w-5 text-red-500" />
      <Settings className="h-6 w-6" />
    </>
  )
}
```

**Icon sizing convention:**
- `h-3 w-3` → 12px (small labels)
- `h-4 w-4` → 16px (default, inline)
- `h-5 w-5` → 20px (emphasis)
- `h-6 w-6` → 24px (large/prominent)

---

## Initial Setup

### 1. Create Vite Project

```bash
npm create vite@latest my-project -- --template react-ts
cd my-project
npm install
```

### 2. Install Core Dependencies

```bash
# UI & Styling
npm install tailwindcss lucide-react
npm install -D @tailwindcss/vite

# Testing & Linting
npm install -D vitest @vitest/ui jsdom oxlint

# TypeScript
npm install -D typescript tsx

# Deployment
npm install -D gh-pages
```

### 3. Initialize shadcn/ui

```bash
npx shadcn-ui@latest init -d
```

Follow prompts:
- **Style**: Default
- **Base color**: Slate (or your preference)
- **CSS variables**: Yes

### 4. Project Configuration Files

Create/update these files (see [Configuration Files](#configuration-files) section below).

### 5. Initialize Git

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/{username}/{repo-name}.git
git branch -M main
git push -u origin main
```

### 6. Configure GitHub Pages

In GitHub repository settings:
- **Settings → Pages → Build and deployment**
- Source: **Deploy from a branch**
- Branch: **gh-pages** (or create it)

---

## Configuration Files

### package.json

Essential scripts and dependencies:

```json
{
  "name": "my-project",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview",
    "test": "vitest run",
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist --dotfiles"
  },
  "dependencies": {
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "lucide-react": "^1.65.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "gh-pages": "^6.3.0",
    "oxlint": "^1.89.0",
    "tailwindcss": "^4.3.3",
    "typescript": "~7.0.2",
    "vite": "^8.3.5",
    "vitest": "^5.0.5",
    "jsdom": "^30.1.3"
  }
}
```

**Key scripts:**
- `npm run dev` → Start dev server (http://localhost:5173)
- `npm run build` → Compile to `/dist` folder
- `npm run lint` → Check code with oxlint
- `npm test` → Run tests
- `npm run deploy` → Build + push to GitHub Pages

### vite.config.ts

```typescript
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Deploy to {username}.github.io/{repo-name}
  // Change this if deploying to a custom domain
  base: '/repo-name/',

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    // Suppress chunk size warnings for expected large bundles
    chunkSizeWarningLimit: 1500,
  },

  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
  },
})
```

**Important**: Update `base` to match your deployment path:
- `base: '/repo-name/'` → Deploys to `{username}.github.io/repo-name/`
- `base: '/'` → Deploys to root (only for `{username}.github.io`)

### tailwind.config.ts

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
} satisfies Config
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "allowJs": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src", "tests"],
  "exclude": ["node_modules", "dist"]
}
```

### .gitignore

```
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Build output
dist/
.env.local

# IDE
.vscode/
.idea/
*.swp
*.swo
```

### .nojekyll

**Create empty file named `.nojekyll` in repo root**

This tells GitHub Pages to serve our static files as-is without Jekyll processing. **This is critical for client-side routers (if using React Router).**

Create via command line:
```bash
touch .nojekyll
git add .nojekyll
git commit -m "Add .nojekyll for GitHub Pages"
```

---

## Component & UI System

### Creating a Component

**File: `src/components/Example.tsx`**

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Heart } from 'lucide-react'

interface ExampleProps {
  title: string
  onAction?: () => void
}

export function Example({ title, onAction }: ExampleProps) {
  const [count, setCount] = useState(0)

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">{title}</h1>

      <p className="text-gray-600 dark:text-gray-400">
        Count: {count}
      </p>

      <div className="flex gap-2">
        <Button onClick={() => setCount(count + 1)}>
          Increment
        </Button>
        <Button
          variant="outline"
          onClick={() => onAction?.()}
        >
          <Heart className="mr-2 h-4 w-4" />
          Action
        </Button>
      </div>
    </div>
  )
}
```

### Component Testing

**File: `tests/unit/Example.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Example } from '@/components/Example'

describe('Example Component', () => {
  it('renders with title', () => {
    render(<Example title="Test Title" />)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
  })

  it('increments count on button click', async () => {
    const { user } = render(<Example title="Test" />)
    const button = screen.getByText('Increment')
    await user.click(button)
    expect(screen.getByText('Count: 1')).toBeInTheDocument()
  })
})
```

### Tailwind CSS Classes

**Common patterns:**

```typescript
// Layout
<div className="flex gap-4">                    {/* Flexbox with gap */}
<div className="grid grid-cols-3 gap-4">        {/* 3-column grid */}
<div className="space-y-2">                     {/* Vertical spacing */}

// Sizing
<div className="w-full h-screen">              {/* Full width & height */}
<div className="max-w-md mx-auto">             {/* Centered, max width */}

// Colors
<div className="bg-blue-50 text-blue-950">     {/* Light background, dark text */}
<div className="dark:bg-gray-900 dark:text-gray-100"> {/* Dark mode */}

// Typography
<h1 className="text-3xl font-bold">            {/* Large, bold heading */}
<p className="text-sm text-gray-600">          {/* Small, muted text */}

// Interactive
<button className="hover:bg-gray-100 active:bg-gray-200">
<button className="disabled:opacity-50 disabled:cursor-not-allowed">

// Dark mode
<div className="bg-white dark:bg-gray-900">    {/* Light/dark versions */}
```

**Dark mode is supported out-of-box via class strategy (prefer over system).**

---

## Build & Deployment

### Local Testing

```bash
# Start dev server with hot reload
npm run dev

# Visit http://localhost:5173
```

### Production Build

```bash
# Compile TypeScript and bundle with Vite
npm run build

# Output in /dist folder
# ~500 KB gzipped for a typical app
```

### Deploy to GitHub Pages

```bash
# One-time setup (done in Initial Setup)
git remote add origin https://github.com/{username}/{repo-name}.git

# Deploy (automated by npm script)
npm run deploy

# This runs:
# 1. npm run build (creates /dist)
# 2. gh-pages pushes /dist to gh-pages branch
# 3. GitHub Pages serves the gh-pages branch

# Your app is live at: https://{username}.github.io/{repo-name}
```

### GitHub Actions (Optional CD)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

Then every push to `main` auto-deploys to GitHub Pages.

---

## Utility Commands

### Development

```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build locally
npm run lint         # Check code with oxlint
npm test             # Run tests
npm test -- --ui     # Run tests with visual UI
npm run deploy       # Build + deploy to GitHub Pages
```

### Common oxlint Commands

```bash
npm run lint                    # Check all files
npm run lint -- --fix          # Auto-fix issues
npm run lint -- src/           # Check specific folder
npm run lint -- --fix -- src/  # Fix specific folder
```

### Adding New shadcn Components

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add input

# See all available: npx shadcn-ui@latest list
```

### Dependency Management

```bash
npm install package-name          # Add dependency
npm install -D dev-package        # Add dev dependency
npm update                         # Update all
npm outdated                       # Check versions
```

---

## Common Patterns

### 1. Form Handling with React

```typescript
export function LoginForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email.includes('@')) {
      setError('Invalid email')
      return
    }

    console.log('Submit:', email)
    setEmail('')
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="w-full rounded border px-3 py-2"
      />
      {error && <p className="text-red-600">{error}</p>}
      <Button type="submit">Login</Button>
    </form>
  )
}
```

### 2. Custom Hooks

**File: `src/components/useLocalStorage.ts`**

```typescript
import { useState, useEffect } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : initialValue
  })

  const setValue = (value: T | ((val: T) => T)) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value
    setStoredValue(valueToStore)
    localStorage.setItem(key, JSON.stringify(valueToStore))
  }

  return [storedValue, setValue] as const
}
```

**Usage:**

```typescript
const [theme, setTheme] = useLocalStorage('theme', 'light')
```

### 3. Async Data Loading

```typescript
import { useState, useEffect } from 'react'

export function DataComponent() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await fetchData() // your async function
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  if (loading) return <p>Loading...</p>
  if (error) return <p className="text-red-600">{error}</p>
  if (!data) return <p>No data</p>

  return <div>{/* Render data */}</div>
}
```

### 4. Conditional Rendering

```typescript
// Option 1: Ternary
{loading ? <Spinner /> : <Content />}

// Option 2: Logical AND (when no else needed)
{isVisible && <Component />}

// Option 3: Early return
if (loading) return <Spinner />
return <Content />

// Option 4: Switch for multiple states
{(() => {
  switch (status) {
    case 'loading':
      return <Spinner />
    case 'error':
      return <Error message={error} />
    case 'success':
      return <Content data={data} />
  }
})()}
```

### 5. Dark Mode Support

**Tailwind handles dark mode via class strategy:**

```html
<!-- HTML root gets dark class -->
<html className="dark">
  ...
</html>
```

**In React:**

```typescript
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  const toggle = () => {
    setIsDark(!isDark)
    document.documentElement.classList.toggle('dark')
  }

  return (
    <button onClick={toggle}>
      {isDark ? '☀️ Light' : '🌙 Dark'}
    </button>
  )
}
```

**Components automatically adapt:**

```typescript
<div className="bg-white dark:bg-gray-900 text-black dark:text-white">
  Automatically switches colors
</div>
```

---

## Replication Checklist

Use this checklist to quickly set up a new client-only React app with the same structure:

### Phase 1: Project Creation (5 min)

- [ ] Run `npm create vite@latest my-project -- --template react-ts`
- [ ] `cd my-project && npm install`
- [ ] Install dependencies: `npm install tailwindcss lucide-react`
- [ ] Install dev dependencies: `npm install -D @tailwindcss/vite vitest @vitest/ui jsdom oxlint gh-pages`
- [ ] Initialize shadcn: `npx shadcn-ui@latest init -d`

### Phase 2: Configuration (10 min)

- [ ] Update `vite.config.ts` with Tailwind plugin, `base` path, and test config
- [ ] Create/update `tailwind.config.ts`
- [ ] Update `tsconfig.json` with strict mode and path aliases
- [ ] Create `tailwind.config.ts`
- [ ] Update `package.json` scripts (dev, build, lint, test, deploy)

### Phase 3: Project Structure (5 min)

- [ ] Create folder structure:
  - `src/components/ui/` (for shadcn - auto-created)
  - `src/lib/`
  - `tests/unit/`
  - `public/`
  - `docs/`

- [ ] Create `src/index.css` with Tailwind directives
- [ ] Create `src/App.tsx` with basic layout
- [ ] Create `src/main.tsx` React entry point
- [ ] Update `public/index.html` with root div

### Phase 4: GitHub Setup (5 min)

- [ ] Create `.nojekyll` file (empty)
- [ ] Create `.gitignore` with node_modules, dist, .env patterns
- [ ] Initialize git: `git init && git add . && git commit -m "Initial commit"`
- [ ] Add remote: `git remote add origin https://github.com/{username}/{repo-name}.git`
- [ ] Push: `git branch -M main && git push -u origin main`

### Phase 5: GitHub Pages Config (5 min)

- [ ] Go to GitHub repo **Settings → Pages**
- [ ] Set source to **"Deploy from a branch"**
- [ ] Select **gh-pages** branch (create if needed)
- [ ] Update `vite.config.ts` `base` to `/repo-name/` (if not root)

### Phase 6: Verification (5 min)

- [ ] Run `npm run dev` → Visit http://localhost:5173
- [ ] Run `npm run build` → Check `/dist` folder
- [ ] Run `npm run deploy` → Check GitHub Pages after 1-2 minutes
- [ ] Verify app loads at https://{username}.github.io/{repo-name}/

### Phase 7: Documentation (5 min)

- [ ] Create `docs/LEARNINGS.md` template
- [ ] Update `README.md` with project description
- [ ] Commit: `git add . && git commit -m "Setup complete"`

---

## Quick Reference: Key Files to Customize

For each new project, update these files:

| File | What to Change |
|------|---|
| `package.json` | Project name, description |
| `vite.config.ts` | `base` path (must match deployment path) |
| `index.html` | Title tag, favicon |
| `src/App.tsx` | Your main component |
| `public/` | Your favicons/images |
| `README.md` | Project description |

---

## Troubleshooting

### Build fails with module not found

**Solution**: Clear cache and reinstall
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### GitHub Pages shows 404

**Solution**: Check `base` in `vite.config.ts` matches your deployment path:
```typescript
// For https://username.github.io/repo-name/
base: '/repo-name/'

// For https://username.github.io/ (only works for {username}.github.io repo)
base: '/'
```

### Changes don't appear after deploy

**Solution**: Clear browser cache or do hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

### Dark mode not working

**Solution**: Add `dark` class to HTML root in `src/main.tsx`:
```typescript
// Optional: auto-detect system preference
if (
  localStorage.theme === 'dark' ||
  (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
) {
  document.documentElement.classList.add('dark')
}
```

---

## Next Steps

1. Follow the **Replication Checklist** to create a new project
2. Commit `.nojekyll` file explicitly
3. Add shadcn components as needed: `npx shadcn-ui@latest add {component}`
4. Build features following the folder structure
5. When spending >2-3 attempts on same issue, add learning to `docs/LEARNINGS.md`

---

## Additional Resources

- [Vite Documentation](https://vite.dev)
- [React Documentation](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [shadcn/ui Components](https://ui.shadcn.com)
- [lucide-react Icons](https://lucide.dev)
- [Vitest Testing](https://vitest.dev)
- [GitHub Pages Docs](https://docs.github.com/en/pages)

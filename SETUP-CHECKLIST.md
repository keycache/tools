# Client-Only React App - Setup Checklist

**Quick reference checklist for replicating this project structure.**

Total time: ~25 minutes

---

## Phase 1: Project Creation (5 min)

```bash
# Create Vite project
npm create vite@latest my-project -- --template react-ts
cd my-project
npm install

# Install dependencies
npm install tailwindcss lucide-react

# Install dev dependencies  
npm install -D @tailwindcss/vite vitest @vitest/ui jsdom oxlint gh-pages

# Initialize UI component system
npx shadcn-ui@latest init -d
```

**Checklist:**
- [ ] Vite project created
- [ ] npm install completed
- [ ] Dependencies installed
- [ ] shadcn/ui initialized

---

## Phase 2: Create Configuration Files (10 min)

### vite.config.ts

```typescript
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/repo-name/',  // CHANGE: Update to match deployment path
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
  },
})
```

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

### package.json scripts

Replace `scripts` section:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview",
    "test": "vitest run",
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist --dotfiles"
  }
}
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
node_modules/
dist/
.env.local
.vscode/
.idea/
package-lock.json
yarn.lock
*.swp
*.swo
```

**Checklist:**
- [ ] vite.config.ts created
- [ ] tailwind.config.ts created
- [ ] package.json scripts updated
- [ ] tsconfig.json updated
- [ ] .gitignore created

---

## Phase 3: Project Structure (5 min)

### Create folder structure

```bash
mkdir -p src/lib
mkdir -p src/components/ui
mkdir -p tests/unit
mkdir -p public
mkdir -p docs
```

### Update src/index.css

```css
@import 'tailwindcss';
```

### Update index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Update src/main.tsx

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

### Update src/App.tsx

```typescript
import { Button } from '@/components/ui/button'

export default function App() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Welcome</h1>
        <p className="text-gray-600 dark:text-gray-400">Your app here</p>
        <Button className="mt-4">Get Started</Button>
      </div>
    </div>
  )
}
```

**Checklist:**
- [ ] Folders created
- [ ] src/index.css updated
- [ ] index.html updated
- [ ] src/main.tsx created
- [ ] src/App.tsx updated

---

## Phase 4: Critical GitHub Pages Setup (5 min)

### Create .nojekyll file

```bash
# Important: This file tells GitHub Pages to skip Jekyll processing
touch .nojekyll
```

**Why?** GitHub Pages by default runs Jekyll (static site generator). Since we're using client-side React routing, we need to disable it.

**Checklist:**
- [ ] .nojekyll file created and committed

### Create initial commit

```bash
git init
git add .
git commit -m "Initial commit"
```

**Checklist:**
- [ ] Git initialized
- [ ] Initial commit made

---

## Phase 5: GitHub Pages Configuration (5 min)

1. Create repo on GitHub: `https://github.com/{username}/{repo-name}`

2. Add remote:
   ```bash
   git remote add origin https://github.com/{username}/{repo-name}.git
   git branch -M main
   git push -u origin main
   ```

3. In GitHub repo, go to **Settings → Pages**

4. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **gh-pages** (create if needed)
   - Folder: **/ (root)**

5. Update `vite.config.ts` `base` path:
   ```typescript
   // If deploying to https://username.github.io/repo-name/
   base: '/repo-name/'
   
   // If deploying to https://username.github.io/ (username.github.io repo only)
   base: '/'
   ```

**Checklist:**
- [ ] GitHub repo created
- [ ] Remote added and pushed
- [ ] GitHub Pages settings configured
- [ ] base path updated in vite.config.ts

---

## Phase 6: Verification (5 min)

### Test locally

```bash
npm run dev
# Visit http://localhost:5173
# Check app loads and hot-reload works
```

### Test build

```bash
npm run build
# Check /dist folder exists with index.html, assets/
```

### Test deployment

```bash
npm run deploy
# This builds and pushes to gh-pages branch
# Wait 1-2 minutes for GitHub Pages to update
# Visit https://{username}.github.io/{repo-name}/
```

**Checklist:**
- [ ] `npm run dev` works
- [ ] `npm run build` produces /dist folder
- [ ] `npm run deploy` succeeds
- [ ] App loads at GitHub Pages URL

---

## Phase 7: Documentation (5 min)

### Create docs/LEARNINGS.md

```markdown
# Project Learnings & Findings

This file documents non-obvious findings encountered while developing this project.
Entries are added when solving issues that took more than 2-3 attempts.

## Example Entry

**Problem**: Description of what went wrong

**Solution**: How you fixed it

**Missteps**: What you tried that didn't work

**Key Insight**: What you learned
```

### Update README.md

```markdown
# Project Name

Brief description of what this app does.

## Tech Stack

- React 19
- TypeScript
- Tailwind CSS
- shadcn/ui
- Vite

## Getting Started

```bash
npm install
npm run dev
```

Visit http://localhost:5173

## Building & Deployment

```bash
npm run build    # Create production build
npm run deploy   # Deploy to GitHub Pages
```

App is live at: https://{username}.github.io/{repo-name}/

## Scripts

- `npm run dev` - Start dev server
- `npm run build` - Build for production
- `npm run lint` - Check code quality
- `npm test` - Run tests
- `npm run deploy` - Deploy to GitHub Pages
```

**Checklist:**
- [ ] docs/LEARNINGS.md created
- [ ] README.md updated
- [ ] All files committed

---

## File Reference

**These are the files you MUST create/update for every new project:**

| File | Status | Details |
|------|--------|---------|
| vite.config.ts | Create | Update `base` path |
| tailwind.config.ts | Create | No changes needed |
| tsconfig.json | Update | Use provided config |
| package.json | Update | scripts section |
| .gitignore | Create | Use provided content |
| .nojekyll | Create | Empty file, very important |
| src/index.css | Create | One line: `@import 'tailwindcss';` |
| index.html | Update | Change title |
| src/main.tsx | Create | Standard React entry |
| src/App.tsx | Update | Your main component |
| docs/LEARNINGS.md | Create | Learning template |
| README.md | Update | Project description |

---

## Path Configuration

**Most important setting: `base` in vite.config.ts**

Choose based on your deployment:

```typescript
// For: https://username.github.io/repo-name/
base: '/repo-name/'

// For: https://username.github.io/ (only for username.github.io repo)
base: '/'

// For: https://custom-domain.com/
base: '/'
```

**If wrong, your CSS/JS won't load (404 errors).**

---

## Common First Steps After Setup

1. Add shadcn components:
   ```bash
   npx shadcn-ui@latest add button
   npx shadcn-ui@latest add card
   npx shadcn-ui@latest add input
   ```

2. Create your first feature folder:
   ```bash
   mkdir src/components/my-feature
   touch src/components/my-feature/MyFeature.tsx
   ```

3. Write a test:
   ```bash
   touch tests/unit/MyFeature.test.ts
   npm test
   ```

4. Deploy:
   ```bash
   npm run deploy
   ```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 errors on deploy | Check `base` in vite.config.ts |
| Styles not loading | Run `npm install`, check Tailwind import in index.css |
| Module not found | Clear `node_modules`, run `npm install` |
| Changes not showing | Hard refresh browser (Cmd+Shift+R) |
| Dark mode not working | Add `dark` class to `<html>` tag in index.html |

---

## Success Criteria

Your project is ready when:

- [ ] `npm run dev` starts without errors
- [ ] App loads in browser with styles
- [ ] `npm run build` creates /dist folder
- [ ] `npm run deploy` completes successfully
- [ ] App is live at GitHub Pages URL
- [ ] Dark mode works
- [ ] Components from shadcn load without errors

**Total setup time: ~25 minutes**

**Next: Build your features!**

# Tools Project: Core Ideas & Architecture Decisions

## Project Overview

This is a **client-side only tools application** – a static website that provides utility tools for image processing and manipulation. Each tool runs entirely in the browser with no backend dependencies.

## Core Architectural Principles

### 1. **Client-Side Only Execution**
- All tools execute in the browser using Web APIs (Canvas, Blob, File API)
- Zero backend dependencies – no servers, APIs, or database calls
- Users can download the tool and run it offline without any connectivity requirements
- Privacy-first: all data processing happens locally; nothing is transmitted

### 2. **Static Build Output**
- Build produces a completely static website (HTML + CSS + JS bundles)
- Deployed via GitHub Pages at `/tools/` path (base path configured in Vite)
- No runtime server required – can be served from any static host
- Fast, lightweight, and highly cacheable for end users

### 3. **Zero External Dependencies for Core Functionality**
- **Allowed dependencies**: Only those that work 100% in browser (no Node.js APIs required)
- **Disallowed**: Any package requiring backend APIs, file system access, or Node.js runtime
- All image processing uses native browser APIs: Canvas, Blob, Image, File
- When adding new tools, validate that all dependencies are browser-compatible

## Project Structure

```
src/
├── components/           # React components for UI
│   ├── [ToolName]Tool.tsx  # Tool-specific component (e.g., AspectResizeTool)
│   ├── ui/               # Reusable shadcn/ui components
│   ├── Hero.tsx          # Landing page hero section
│   ├── ToolList.tsx      # Tool catalog/directory
│   └── [SharedComponents].tsx
├── lib/                  # Utility functions & hooks
│   ├── [feature].ts      # Feature-specific utilities (e.g., image.ts, aspect.ts)
│   ├── useHashRoute.ts   # Client-side routing hook
│   └── utils.ts          # General utilities
├── tools.ts              # Tool registry (Tool[] array)
├── App.tsx               # Main app router
├── main.tsx              # React entry point
└── index.css             # Global styles (Tailwind)

dist/                     # Build output (static files)
tests/                    # Vitest unit tests
```

## Component Design Patterns

### Tool Registration
- **Central registry**: `src/tools.ts` defines `TOOLS: Tool[]`
- **Tool interface**: 
  ```typescript
  interface Tool {
    id: string;           // URL-friendly identifier (e.g., 'aspect-resize')
    name: string;         // Display name
    description: string;  // Short description for tool listing
    component: ComponentType;  // React component that renders the tool
  }
  ```
- **Adding a tool**: Create component, add to TOOLS array, done – routing is automatic

### Routing Strategy
- **Hash-based routing**: Uses URL fragments (`#/tool-id`)
- **No external router**: Custom `useHashRoute()` hook with `useSyncExternalStore`
- **Lightweight**: Avoids React Router dependency; perfect for static sites
- **Deep-linking friendly**: Every tool has a shareable URL

### Component Organization
- **Tool components** (e.g., `AspectResizeTool.tsx`): Stateful, feature-complete tools
- **UI components** (e.g., `Button`, `Slider`, `Card`): Reusable shadcn/ui-based components
- **Shared helpers**: `ImageDropzone`, `CropEditor` – reusable feature components
- **Single Responsibility**: Each component has one clear purpose

## Technology Stack

### Core
- **React 19** – UI framework
- **TypeScript 7** – Type safety
- **Vite 8** – Build tool & dev server
- **Tailwind CSS 4** – Utility-first styling

### UI Components
- **shadcn/ui** – Pre-built, copy-paste components
- **@base-ui/react** – Headless UI components with accessibility
- **Lucide React** – Icon library (all browser-safe)

### Styling & Utilities
- **class-variance-authority** – Component class variants
- **clsx** – Conditional className utilities
- **tailwind-merge** – Merge Tailwind classes safely
- **tw-animate-css** – Animation utilities
- **@fontsource-variable/geist** – Self-hosted font

### Development
- **Oxlint** – Fast, zero-config linting
- **Vitest** – Unit testing (same config as Vite)
- **TypeScript Compiler** – Type checking (`tsc -b`)
- **gh-pages** – GitHub Pages deployment

### Key Constraints
- ✅ All dependencies are NPM packages (no native bindings)
- ✅ All work in browser (no Node.js-specific APIs)
- ✅ No async backend calls or API clients
- ✅ No database or state persistence beyond localStorage/IndexedDB

## Build & Deployment

### Development
```bash
npm run dev      # Vite dev server at http://localhost:5173
```

### Production
```bash
npm run build    # TypeScript check + Vite bundle → dist/
npm run preview  # Preview production build locally
npm run deploy   # Push dist/ to GitHub Pages
```

### Build Specifics
- **Base path**: `/tools/` (configured in vite.config.ts)
- **Output**: Single `dist/` folder with all static assets
- **No environment files**: Configuration is in code (not secrets)

## Code Quality

### Linting
- **Oxlint**: Fast, Rust-based linter (configured in `.oxlintrc.json`)
- No TypeScript-specific linting (Oxlint covers that)

### Testing
- **Vitest**: Unit tests in `tests/unit/` directory
- Only client-side logic testable (no backend mocks needed)

### Type Checking
- **TypeScript strict mode** enabled
- `tsconfig.json` - main config
- `tsconfig.app.json` - app-specific settings
- `tsconfig.node.json` - Vite/build config

## Data Flow & State Management

### Per-Tool State
- Tools manage state independently (React `useState`)
- No global state management needed (unless > 3 tools share data)
- Example: `AspectResizeTool` has local state for image, ratio, format, quality

### File Handling
- Users upload files via file inputs or drag-drop
- Files stay in memory as `File` → `Blob` → Canvas operations
- Download via `URL.createObjectURL(blob)` + link click
- No persistence between sessions (intentional)

### Routing State
- Current tool ID stored in URL hash
- Survives page refresh automatically
- Share-friendly (URL is the state)

## Important Design Decisions

### Why Client-Side Only?
- **Privacy**: No data leaves the user's machine
- **Offline-first**: Works without internet connectivity
- **Cost**: Zero server costs
- **Instant**: No latency from backend round-trips
- **Maintenance**: No backend to maintain or scale

### Why Hash Routing?
- Works on static hosts (no server rewrite rules needed)
- Simple to implement (no react-router dependency)
- URL fragments survive file:// protocol
- GitHub Pages doesn't support history API

### Why Tailwind CSS?
- Minimal CSS output (tree-shaked)
- Built-in dark mode support
- Utility-first matches React component model
- No CSS-in-JS overhead

### Why Vite?
- Instant cold starts
- Fast HMR for development
- Excellent TypeScript support
- Small bundle size vs Webpack
- Perfect for static site builds

### Why Canvas for Image Processing?
- Native browser API (no dependencies)
- GPU-accelerated on modern browsers
- Works offline
- Can export multiple formats (PNG, JPEG, WebP)

## Adding New Tools

### Checklist
1. **Create component**: `src/components/NewToolName.tsx`
2. **Add to registry**: Update `src/tools.ts` with new Tool entry
3. **Write tests**: Add tests in `tests/unit/`
4. **Update README**: Document in project README if needed
5. **Verify**: Run `npm run build` and test in `/tools/#/new-tool-id`

### Requirements
- ✅ Component must be client-side only
- ✅ No external API calls
- ✅ All dependencies must work in browser
- ✅ Component should be self-contained
- ✅ Include error handling for edge cases

## Performance Considerations

### Bundle Size
- Tree-shake unused UI components from shadcn
- Vite handles code splitting automatically
- Tailwind purges unused classes at build time

### Runtime Performance
- Canvas operations may be slow for large images (caveat in UI)
- Consider Web Workers for very heavy processing
- Use `useSyncExternalStore` for route changes (no rerender overhead)

### Accessibility
- base-ui components are fully accessible by default
- Ensure labels on all form inputs
- Keyboard navigation for all interactive elements
- Test with screen readers periodically

## Constraints & Limitations

- ❌ Cannot process files larger than available browser memory
- ❌ Cannot run long operations without UI blocking (use Web Workers)
- ❌ Cannot persist data across sessions (by design)
- ❌ No real-time collaboration features
- ❌ Cannot access file system (except user-selected uploads)

## Future Considerations

If you need to add a feature that seems to require a backend:
1. **First try**: Solve it client-side (Web Workers, IndexedDB, etc.)
2. **If impossible**: Document why, discuss with team
3. **Workaround**: Consider splitting into browser tool + external reference docs

---

**Remember**: This is a tools-first, browser-first project. Every decision should prioritize client-side execution and static deployment. When in doubt, ask: "Can this run in a browser without a server?"

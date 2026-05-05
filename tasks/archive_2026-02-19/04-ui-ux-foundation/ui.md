# Admin UI Design Reference — hrm8-admin-staff

> **Purpose:** Give this file + your feature requirements to an AI agent and it can scaffold a visually identical app using the same stack, theme, and patterns.

---

## 1. Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Routing | React Router v6 |
| Styling | Tailwind CSS v3 (CSS variables, no arbitrary values) |
| Component Library | **shadcn/ui** — style: `new-york`, base color: `neutral` |
| Icons | **Lucide React** (exclusively) |
| Charts | **Recharts** wrapped in shadcn `ChartContainer` / `ChartTooltip` |
| State | Zustand stores |
| Forms | React Hook Form + Zod |
| Notifications | shadcn `Toaster` + `Sonner` (top-right, richColors) |
| Package Manager | pnpm |

---

## 2. Design Language — "Greyish Codex" Theme

The app uses a **neutral grey tone** for backgrounds and surfaces, with an **indigo-blue primary accent**. It supports both light and dark modes.

### 2.1 CSS Variables (paste into `src/index.css`)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }

  :root {
    /* Backgrounds */
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;

    /* Brand — Indigo Blue */
    --primary: 236 79% 64%;
    --primary-foreground: 0 0% 100%;
    --secondary: 236 79% 64%;
    --secondary-foreground: 0 0% 100%;

    /* Muted / Accent — Light grey */
    --muted: 250 20% 96%;
    --muted-foreground: 250 10% 45%;
    --accent: 250 20% 96%;
    --accent-foreground: 250 20% 9%;

    /* Semantic */
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --success: 142 71% 45%;
    --success-foreground: 0 0% 98%;
    --warning: 38 92% 50%;
    --warning-foreground: 0 0% 9%;
    --info: 199 89% 48%;
    --info-foreground: 0 0% 98%;

    /* Borders & Inputs */
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;

    /* Charts */
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;

    /* Sidebar — slightly off-white */
    --sidebar-background: 0 0% 98%;
    --sidebar-foreground: 0 0% 9%;
    --sidebar-primary: 0 0% 9%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 250 20% 96%;
    --sidebar-accent-foreground: 250 20% 9%;
    --sidebar-border: 0 0% 89.8%;
    --sidebar-ring: 0 0% 3.9%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 0 0% 7%;       /* Very dark grey, NOT pure black */
    --foreground: 0 0% 95%;
    --card: 0 0% 9%;
    --card-foreground: 0 0% 95%;
    --popover: 0 0% 9%;
    --popover-foreground: 0 0% 95%;

    --primary: 236 79% 64%;      /* Same indigo in dark */
    --primary-foreground: 0 0% 100%;
    --secondary: 236 79% 64%;
    --secondary-foreground: 0 0% 100%;

    --muted: 0 0% 15%;
    --muted-foreground: 0 0% 60%;
    --accent: 0 0% 15%;
    --accent-foreground: 0 0% 95%;

    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 95%;
    --success: 142 70% 38%;
    --success-foreground: 0 0% 98%;
    --warning: 38 92% 50%;
    --warning-foreground: 0 0% 9%;
    --info: 199 89% 48%;
    --info-foreground: 0 0% 98%;

    --border: 0 0% 20%;
    --input: 0 0% 20%;
    --ring: 0 0% 80%;

    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;

    --sidebar-background: 0 0% 7%;
    --sidebar-foreground: 0 0% 95%;
    --sidebar-primary: 0 0% 95%;
    --sidebar-primary-foreground: 0 0% 9%;
    --sidebar-accent: 0 0% 12%;
    --sidebar-accent-foreground: 0 0% 95%;
    --sidebar-border: 0 0% 20%;
    --sidebar-ring: 0 0% 80%;
  }
}

@layer utilities {
  .smooth-scroll { scroll-behavior: smooth; }

  .gradient-primary {
    background: linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%);
  }
  .gradient-success {
    background: linear-gradient(135deg, hsl(var(--success)) 0%, hsl(var(--success) / 0.7) 100%);
  }
  .gradient-warning {
    background: linear-gradient(135deg, hsl(var(--warning)) 0%, hsl(var(--warning) / 0.7) 100%);
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .animate-fadeIn { animation: fadeIn 0.5s ease-out; }

  /* Glass effect (used in overlays) */
  .glass-effect {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
}
```

### 2.2 Tailwind Config (`tailwind.config.js`)

```js
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        chart: { '1': 'hsl(var(--chart-1))', '2': 'hsl(var(--chart-2))', '3': 'hsl(var(--chart-3))', '4': 'hsl(var(--chart-4))', '5': 'hsl(var(--chart-5))' },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
```

### 2.3 shadcn `components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/shared/components",
    "utils": "@/shared/lib/utils",
    "ui": "@/shared/components/ui",
    "lib": "@/shared/lib",
    "hooks": "@/shared/hooks"
  }
}
```

---

## 3. App Skeleton & Folder Structure

```
src/
├── App.tsx                    # Route definitions (React Router v6)
├── index.css                  # Global CSS + theme variables
├── main.tsx                   # Entry point
├── pages/                     # Page-level components (one per route)
│   ├── auth/
│   │   └── LoginPage.tsx
│   └── [role]/                # e.g. hrm8/, consultant/, sales/
│       ├── SomePage.tsx
│       └── workspace/
│           ├── WorkspacePage.tsx   # Nested layout wrapper
│           └── SubPage.tsx
├── shared/
│   ├── components/
│   │   ├── ui/                # shadcn primitives (button, card, badge, etc.)
│   │   ├── layouts/
│   │   │   └── unified/
│   │   │       ├── UnifiedDashboardLayout.tsx  # Root layout
│   │   │       ├── UnifiedSidebar.tsx
│   │   │       ├── UnifiedHeader.tsx
│   │   │       └── UnifiedSidebarFooter.tsx
│   │   ├── common/            # CommandPalette, Breadcrumbs, ThemeToggle, AiAssistantSidebar
│   │   ├── dashboard/         # DashboardStatCard, chart widgets
│   │   ├── tables/            # Reusable data table components
│   │   └── [feature]/         # Feature-specific components
│   ├── config/
│   │   └── navigation.ts      # Role-based sidebar menu items
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utilities (api.ts, utils.ts, chart-utils.ts)
│   ├── services/              # API service modules
│   ├── stores/                # Zustand stores (authStore, etc.)
│   └── types/                 # TypeScript types
└── contexts/                  # React contexts (Auth, WebSocket, Currency)
```

---

## 4. Layout Architecture

### 4.1 Root Layout — `UnifiedDashboardLayout`

Every protected page is wrapped in this layout. It composes:

```
SidebarProvider
└── div.flex.h-svh.w-full.overflow-hidden
    ├── UnifiedSidebar          (left, collapsible)
    └── SidebarInset.flex.flex-col.flex-1.min-h-0.overflow-hidden
        ├── UnifiedHeader       (sticky top bar, h-14)
        └── div.flex.flex-1.min-h-0.overflow-hidden
            ├── main.flex-1.min-h-0.overflow-y-auto.p-4.md:p-6.lg:p-8
            │   └── div.mx-auto.max-w-7xl.w-full
            │       └── {page content}
            └── [CustomResizablePanel]   (optional AI assistant, right side)
```

**Key classes:**
- `h-svh` — full viewport height
- `overflow-hidden` on outer containers, `overflow-y-auto` only on the scrollable main area
- `max-w-7xl mx-auto` — content max width with auto centering

### 4.2 Routing Pattern

```tsx
// App.tsx — protected routes wrap with RoleGuard + DashboardWrapper
<Route element={<RoleGuard allowedTypes={['ADMIN']}><DashboardWrapper /></RoleGuard>}>
  <Route path="/dashboard" element={<DashboardPage />} />

  {/* Workspace with nested tabs */}
  <Route path="/workspace" element={<WorkspacePage />}>
    <Route index element={<Navigate to="overview" replace />} />
    <Route path="overview" element={<OverviewPage />} />
    <Route path="list" element={<ListPage />} />
    <Route path="settings" element={<SettingsPage />} />
  </Route>
</Route>
```

**DashboardWrapper:**
```tsx
function DashboardWrapper() {
  return (
    <UnifiedDashboardLayout>
      <Outlet />
    </UnifiedDashboardLayout>
  );
}
```

---

## 5. Sidebar

### 5.1 Behavior
- Uses shadcn `Sidebar` component with `collapsible="icon"`
- **Collapsed:** shows only icons (w-16), tooltips on hover
- **Expanded:** shows icon + label (w-64)
- **Hover-expand:** when collapsed, hovering expands it temporarily
- Active item: `bg-sidebar-accent text-sidebar-accent-foreground font-medium`
- Nested child routes: indented `ml-8`, smaller text, `text-sm`

### 5.2 Structure
```
SidebarHeader (border-b, logo + subtitle)
SidebarContent
  SidebarGroup
    SidebarGroupContent
      SidebarMenu
        SidebarMenuItem × N     (each nav item)
          SidebarMenuButton (NavLink)
            Icon (h-5 w-5) + Label
          [nested children ml-8 mt-1 space-y-0.5]
SidebarFooter (border-t, logout + footer actions)
```

### 5.3 Navigation Config Pattern

```ts
// shared/config/navigation.ts
const menuItems: MenuItem[] = [
  { id: "overview",   path: "/app/dashboard", label: "Overview",  icon: LayoutDashboard },
  { id: "analytics",  path: "/app/analytics", label: "Analytics", icon: BarChart3, adminOnly: true },
  { id: "users",      path: "/app/users",     label: "Users",     icon: Users },
  { id: "settings",   path: "/app/settings",  label: "Settings",  icon: Settings, adminOnly: true },
];

// MenuItem type
interface MenuItem {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  badge?: React.ComponentType;  // optional badge component (e.g. notification count)
}
```

---

## 6. Header

**Height:** `h-14` (56px), sticky, `z-50`

**Structure (left → right):**
```
[SidebarTrigger] | [Separator] | [Breadcrumbs]      [flex-1 spacer]      [SearchBar] | [ThemeToggle] [NotificationBell] | [UserNav]
```

**Search bar** — fake input that opens `CommandPalette` on click:
```tsx
<div className="flex items-center gap-2 h-9 rounded-md border bg-background px-3 hover:bg-accent cursor-pointer">
  <Search className="h-3.5 w-3.5 text-muted-foreground" />
  <span className="text-sm text-muted-foreground">Search...</span>
  <kbd className="ml-auto inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-mono text-muted-foreground">
    ⌘K
  </kbd>
</div>
```

**Header classes:**
```
sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur
```

---

## 7. Page Layout Patterns

### 7.1 Standard Page

```tsx
// Every page follows this structure
<div className="p-6 space-y-6">
  {/* Page Header */}
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Page Title</h1>
      <p className="text-muted-foreground mt-1 text-sm md:text-base">Subtitle or description</p>
    </div>
    <div className="flex items-center gap-3">
      {/* Actions: filters, date pickers, buttons */}
    </div>
  </div>

  {/* Stat Cards Row */}
  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
    <DashboardStatCard ... />
  </div>

  {/* Main Content — Tabs or Cards */}
  <Tabs defaultValue="tab1" className="space-y-6">
    <TabsList className="grid w-full grid-cols-4 h-auto rounded-xl border border-border/60 bg-background p-1">
      <TabsTrigger
        value="tab1"
        className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors
                   data-[state=active]:bg-muted data-[state=active]:text-foreground
                   data-[state=active]:border data-[state=active]:border-border/60"
      >
        Tab 1
      </TabsTrigger>
    </TabsList>
    <TabsContent value="tab1" className="space-y-6">
      {/* Content */}
    </TabsContent>
  </Tabs>
</div>
```

### 7.2 Workspace Page (nested sub-navigation)

A workspace groups related sub-pages. The workspace page is a route parent that renders `<Outlet />`.

```tsx
// WorkspacePage.tsx
export default function WorkspacePage() {
  return (
    <main className="flex-1 min-w-0">
      <div className="p-2 lg:p-3">
        <Outlet />
      </div>
    </main>
  );
}

// Route definition in App.tsx
<Route path="/workspace" element={<WorkspacePage />}>
  <Route index element={<Navigate to="overview" replace />} />
  <Route path="overview" element={<OverviewPage />} />
  <Route path="list" element={<ListPage />} />
  <Route path="settings" element={<SettingsPage />} />
</Route>
```

The sidebar handles workspace sub-navigation via **nested routes** shown as indented children under the parent menu item.

---

## 8. Key Components

### 8.1 DashboardStatCard

```tsx
// Usage
<DashboardStatCard
  title="Open Jobs"
  value="142"
  icon={Briefcase}
  description="Operational jobs"
  trend="up"
  trendValue="+8.2%"
  onClick={() => navigate('/jobs')}
  loading={isLoading}
  showBackgroundGraph
  graphData={[10, 20, 15, 30, 25, 40]}  // sparkline data
/>
```

**Visual:** White/dark card with title, large number, trend badge (green/red pill), optional sparkline chart at bottom.

### 8.2 Card Pattern (shadcn Card)

```tsx
<Card>
  <CardHeader className="pb-2">
    <CardTitle>Section Title</CardTitle>
    <CardDescription>Supporting description text</CardDescription>
  </CardHeader>
  <CardContent>
    {/* content */}
  </CardContent>
</Card>
```

### 8.3 Badge Variants

```tsx
// Standard shadcn variants
<Badge variant="default">Primary</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Error</Badge>

// Semantic status variants
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>

// Soft/subtle variants (bg-color/10 with colored text)
<Badge variant="neutral">Neutral</Badge>

// Inline status pattern (no Badge component)
<span className="text-green-700 bg-green-500/20 text-sm font-medium px-1.5 rounded-full">
  +8.2%
</span>
```

### 8.4 Data Table Pattern

```tsx
<div className="rounded-md border">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead className="text-right">Value</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell>
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.subtitle}</p>
              </div>
            </div>
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {item.value}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
```

### 8.5 Skeleton Loading Pattern

```tsx
// Chart skeleton
function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[320px] w-full" />
      </CardContent>
    </Card>
  );
}

// List item skeleton
function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
```

### 8.6 Empty State

```tsx
<EmptyState
  icon={Inbox}
  title="No items found"
  description="There are no items matching your criteria."
  action={{ label: "Create New", onClick: () => {} }}
/>
```

**Visual:** Centered, icon in a rounded `bg-muted` circle, heading, description, optional CTA button.

### 8.7 Alert / Error State

```tsx
<Alert variant="destructive">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Error Title</AlertTitle>
  <AlertDescription>Error message here.</AlertDescription>
</Alert>
```

### 8.8 Sheets / Drawers (right-side panels)

Used for create/edit forms instead of modals:
```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button>Open Panel</Button>
  </SheetTrigger>
  <SheetContent className="w-[500px] sm:max-w-[500px]">
    <SheetHeader>
      <SheetTitle>Panel Title</SheetTitle>
      <SheetDescription>Description</SheetDescription>
    </SheetHeader>
    {/* form content */}
  </SheetContent>
</Sheet>
```

### 8.9 Charts (shadcn ChartContainer + Recharts)

```tsx
const chartConfig = {
  value: { label: "Value", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

<ChartContainer config={chartConfig} className="h-[320px] w-full">
  <AreaChart data={data}>
    <defs>
      <linearGradient id="fillValue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor="var(--color-value)" stopOpacity={0.8} />
        <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.1} />
      </linearGradient>
    </defs>
    <CartesianGrid strokeDasharray="3 3" vertical={false} />
    <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
    <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Area type="monotone" dataKey="value" stroke="var(--color-value)"
          strokeWidth={2} fillOpacity={1} fill="url(#fillValue)" />
  </AreaChart>
</ChartContainer>
```

---

## 9. Typography Conventions

| Element | Classes |
|---|---|
| Page title (H1) | `text-2xl md:text-3xl font-semibold tracking-tight` |
| Section title | `text-lg font-semibold` or `CardTitle` |
| Subtitle / description | `text-muted-foreground mt-1 text-sm md:text-base` |
| Table header | `text-xs font-semibold text-muted-foreground uppercase` |
| Large metric number | `text-3xl font-bold` |
| Small label | `text-xs text-muted-foreground` |
| Monospace numbers | `tabular-nums` |

---

## 10. Spacing & Grid Conventions

| Pattern | Classes |
|---|---|
| Page padding | `p-6` |
| Section spacing | `space-y-6` |
| Card grid (4 cols) | `grid gap-6 md:grid-cols-2 lg:grid-cols-4` |
| Card grid (2 cols) | `grid gap-6 lg:grid-cols-2` |
| Form fields | `space-y-4` |
| Inline items | `flex items-center gap-2` or `gap-3` |
| Avatar + text | `flex items-center gap-3` |
| Button group | `flex items-center gap-2` |

---

## 11. Color Usage Patterns

| Semantic | Tailwind / CSS Var |
|---|---|
| Primary action | `bg-primary text-primary-foreground` |
| Muted background | `bg-muted` |
| Subtle text | `text-muted-foreground` |
| Success indicator | `text-green-700 bg-green-500/20` (inline) or `variant="success"` |
| Error indicator | `text-red-700 bg-red-500/20` (inline) or `variant="destructive"` |
| Primary tint | `bg-primary/10 text-primary` (avatar fallbacks, icon backgrounds) |
| Hover state | `hover:bg-accent` |
| Active nav item | `bg-sidebar-accent text-sidebar-accent-foreground` |
| Border | `border-border` or `border-border/60` (subtle) |

---

## 12. Common UX Patterns

### Loading States
- Use `Skeleton` components that mirror the exact shape of the real content
- Show `<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />` in headers during background loads
- Lazy-load tab content (only fetch when tab is first activated)

### Error States
- Use `<Alert variant="destructive">` for page-level errors
- Show inline error text for form fields via `react-hook-form` + shadcn `FormMessage`

### Navigation
- `<NavLink>` for sidebar links (auto active state)
- `useNavigate()` for programmatic navigation
- Breadcrumbs auto-generated from route path

### Forms
- Right-side `Sheet` for create/edit (not modals)
- `Dialog` only for confirmations and small quick-actions
- `AlertDialog` for destructive confirmations (delete, etc.)

### Notifications
- `toast()` from sonner for success/error feedback
- `NotificationBell` in header for in-app notifications

---

## 13. Shadcn Components Used

Install these via `npx shadcn@latest add [component]`:

```
accordion alert alert-dialog avatar badge breadcrumb button calendar
card carousel chart checkbox collapsible command context-menu dialog
drawer dropdown-menu form hover-card input label navigation-menu
pagination popover progress radio-group resizable scroll-area select
separator sheet sidebar skeleton slider sonner switch table tabs
textarea toast toggle toggle-group tooltip
```

Additional custom components built on top:
- `dashboard-stat-card` — KPI card with sparkline
- `empty-state` — empty list/table state
- `date-range-picker-v2` — advanced date range picker
- `rich-text-editor` — TipTap-based editor
- `tag-input` — multi-tag input
- `file-upload` — drag-and-drop file upload
- `import-dialog` — CSV import flow
- `warning-confirmation-dialog` — typed confirmation dialog

---

## 14. How to Scaffold a New App Using This Design

1. **Init project:** `npm create vite@latest my-app -- --template react-ts`
2. **Install deps:** `pnpm add tailwindcss-animate class-variance-authority clsx tailwind-merge lucide-react recharts react-router-dom zustand react-hook-form zod @hookform/resolvers sonner`
3. **Init shadcn:** `npx shadcn@latest init` — choose `new-york`, `neutral`, CSS variables
4. **Copy `index.css`** from Section 2.1 above
5. **Copy `tailwind.config.js`** from Section 2.2 above
6. **Create folder structure** from Section 3
7. **Build `UnifiedDashboardLayout`** with `SidebarProvider`, `UnifiedSidebar`, `UnifiedHeader`
8. **Define navigation** in `shared/config/navigation.ts` with your menu items
9. **Set up routes** in `App.tsx` following the `RoleGuard + DashboardWrapper + Outlet` pattern
10. **Build pages** using: `p-6 space-y-6` wrapper → page header → stat cards grid → tabs/cards

---

## 15. Key Design Principles

1. **Grey is the base** — backgrounds are neutral greys, not white or black extremes
2. **Indigo accent** — primary color is `hsl(236 79% 64%)`, used sparingly for CTAs and active states
3. **Borders are subtle** — `border-border/60` for internal dividers, `border-border` for card edges
4. **Muted text hierarchy** — use `text-muted-foreground` for secondary info, never raw grey hex values
5. **Consistent spacing** — `space-y-6` between sections, `gap-6` in grids, `gap-3` for inline items
6. **Skeleton-first loading** — always show skeleton shapes, never blank screens or spinners alone
7. **Sheets over modals** — use right-side `Sheet` for forms, `Dialog` only for confirmations
8. **Lucide icons only** — `h-4 w-4` for inline, `h-5 w-5` for sidebar, `h-10 w-10` for empty states
9. **Tabular numbers** — always use `tabular-nums` on numeric data in tables
10. **Responsive grid** — always define `md:` and `lg:` breakpoints for grids

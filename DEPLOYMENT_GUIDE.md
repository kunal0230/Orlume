# Orlume Deployment Guide

## Architecture Overview

| Domain | Content | Entry Point |
|--------|---------|-------------|
| `orlume.io` | Landing Page | `index.html` |
| `editor.orlume.io` | Photo Editor | `editor.html` |

Both domains serve from the same codebase with **clean URLs** (no `.html` extension visible).

---

## Option 1: Vercel (Recommended)

### Step 1: Create Two Projects

#### Project A: Landing Page (`orlume.io`)

1. Import your repo to Vercel
2. Set **Root Directory**: `.` (root)
3. Create `vercel.json` in project root:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "cleanUrls": true,
  "rewrites": [
    { "source": "/editor", "destination": "/editor.html" },
    { "source": "/((?!assets|images|.*\\..*).*)", "destination": "/index.html" }
  ]
}
```

1. Add custom domain: `orlume.io`

#### Project B: Editor (`editor.orlume.io`)

1. Import the **same repo** as a new Vercel project
2. Create a separate `vercel-editor.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "cleanUrls": true,
  "rewrites": [
    { "source": "/((?!assets|.*\\..*).*)", "destination": "/editor.html" }
  ]
}
```

1. Rename to `vercel.json` in Vercel settings or use Build Override
2. Add custom domain: `editor.orlume.io`

---

## Option 2: Single Vercel Project with Edge Middleware

Create `middleware.js` at project root:

```javascript
export const config = {
  matcher: '/((?!api|_next|assets|images|.*\\..*).*)',
};

export default function middleware(request) {
  const url = new URL(request.url);
  const hostname = request.headers.get('host');
  
  // Editor subdomain
  if (hostname?.startsWith('editor.')) {
    if (url.pathname === '/' || !url.pathname.includes('.')) {
      return Response.redirect(new URL('/editor.html', request.url));
    }
  }
  
  // Landing page (main domain)
  return;
}
```

Update `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "cleanUrls": true
}
```

---

## Option 3: Netlify

### `netlify.toml`

```toml
[build]
  command = "npm run build"
  publish = "dist"

# Landing page rewrites
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  conditions = {Host = ["orlume.io", "www.orlume.io"]}

# Editor subdomain rewrites  
[[redirects]]
  from = "/*"
  to = "/editor.html"
  status = 200
  conditions = {Host = ["editor.orlume.io"]}

# Clean URLs
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
```

---

## Option 4: Cloudflare Pages

### `_redirects` file in `public/`

```
# Editor subdomain
https://editor.orlume.io/*  /editor.html  200

# Landing page (default)
/*  /index.html  200
```

### `_headers` file in `public/`

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
```

---

## Cross-Domain Navigation

The landing page automatically updates editor links for production:

```javascript
// Already in index.html
const IS_PROD = window.location.hostname === 'orlume.io';
if (IS_PROD) {
  document.querySelectorAll('a[href*="editor"]').forEach(link => {
    link.href = 'https://editor.orlume.io';
  });
}
```

---

## DNS Configuration

Add these records to your domain registrar:

| Type | Name | Value |
|------|------|-------|
| A | `@` | Vercel/Netlify IP |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `editor` | `cname.vercel-dns.com` |

---

## Testing Locally

```bash
# Start dev server
npm run dev

# Access:
# Landing: http://localhost:5174/
# Editor:  http://localhost:5174/editor.html
```

---

## Build for Production

```bash
npm run build

# Output in dist/
# - index.html (landing)
# - editor.html (editor)
# - assets/ (JS, CSS, images)
```

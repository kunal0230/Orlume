# Orlume AI Photo Editor

## Landing Website Planning Document

---

**Version:** 1.0  
**Date:** December 27, 2025  
**Author:** Planning Document for Orlume Photo Editor  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Target Audience](#2-target-audience)
3. [Website Structure & Sitemap](#3-website-structure--sitemap)
4. [Hero Section](#4-hero-section)
5. [Features Showcase](#5-features-showcase)
6. [How It Works](#6-how-it-works)
7. [Use Cases & Examples](#7-use-cases--examples)
8. [Pricing Strategy](#8-pricing-strategy)
9. [Trust & Social Proof](#9-trust--social-proof)
10. [Call-to-Action Strategy](#10-call-to-action-strategy)
11. [Technical Pages](#11-technical-pages)
12. [SEO & Content Strategy](#12-seo--content-strategy)
13. [Design Guidelines](#13-design-guidelines)
14. [Competitive Positioning](#14-competitive-positioning)
15. [Launch Checklist](#15-launch-checklist)

---

## 1. Executive Summary

## Product Overview

Orlume is a **browser-based AI photo editor** that combines professional-grade image editing with cutting-edge AI capabilities. It runs entirely in the browser using WebGL2 for GPU-accelerated processing, offering desktop-quality editing without downloads or installations.

## Unique Selling Propositions (USPs)

1. **No Installation Required** - Works instantly in any modern browser
2. **GPU-Accelerated** - Real-time editing powered by WebGL2
3. **AI-Powered Tools** - Intelligent upscaling, healing, relighting
4. **Privacy-First** - Images never leave your device (local processing)
5. **Professional Results** - Lightroom-quality adjustments
6. **Free to Use** - Core features available at no cost

## Key Competitors

- Adobe Lightroom (desktop/web)
- Photopea (web)
- Pixlr (web)
- Canva Photo Editor
- Fotor

---

## 2. Target Audience

## Primary Audiences

### 1. Amateur Photographers (35%)

- **Demographics:** 18-35, hobbyists, social media users
- **Pain Points:**
  - Can't afford/justify Adobe subscription
  - Overwhelmed by complex software
  - Need quick edits for social media
- **Value Proposition:** Professional results without the learning curve

### 2. Content Creators & Influencers (25%)

- **Demographics:** 20-40, YouTubers, Instagrammers, TikTokers
- **Pain Points:**
  - Need fast batch processing
  - Require consistent aesthetic
  - Work across multiple devices
- **Value Proposition:** Consistent, fast edits from anywhere

### 3. Professional Photographers (20%)

- **Demographics:** 25-50, freelancers, studio photographers
- **Pain Points:**
  - Subscription fatigue
  - Need quick client previews
  - Heavy local software
- **Value Proposition:** Light alternative for quick edits

### 4. Small Business Owners (10%)

- **Demographics:** 25-55, e-commerce, real estate, restaurants
- **Pain Points:**
  - No design expertise
  - Budget constraints
  - Need product photos
- **Value Proposition:** Easy product photo enhancement

### 5. Developers & Tech Enthusiasts (10%)

- **Demographics:** 20-40, interested in WebGL, AI tech
- **Pain Points:**
  - Curious about implementation
  - Want hackable tools
- **Value Proposition:** Open, modern tech stack

---

## 3. Website Structure & Sitemap

```
orlume.app/
├── / (Homepage/Landing)
├── /editor (The actual editor - main product)
├── /features
│   ├── /features/develop
│   ├── /features/crop-transform
│   ├── /features/masks
│   ├── /features/healing
│   ├── /features/liquify
│   ├── /features/ai-upscale
│   └── /features/relight
├── /pricing
├── /examples
│   └── /examples/[category] (Portraits, Landscapes, etc.)
├── /compare
│   └── /compare/lightroom
├── /blog
│   └── /blog/[post-slug]
├── /docs
│   ├── /docs/getting-started
│   ├── /docs/shortcuts
│   └── /docs/tutorials
├── /about
├── /privacy
├── /terms
└── /contact
```

---

## 4. Hero Section

## Primary Goal

Capture attention in < 5 seconds and communicate the core value proposition.

## Recommended Content

### Headline Options (A/B Test)

1. **"Professional Photo Editing. Zero Downloads."**
2. **"AI-Powered Editing in Your Browser"**
3. **"Edit Photos Like a Pro. Instantly. Free."**
4. **"The Photo Editor That Runs Anywhere"**

### Subheadline

"GPU-accelerated editing with AI-powered tools. No installation. No login required. Just drag, drop, and create."

### Primary CTA Button

- **Text:** "Start Editing Free" or "Open Editor"
- **Style:** Large, high-contrast, vibrant color
- **Action:** Opens /editor directly

### Secondary CTA

- **Text:** "See Features" or "Watch Demo"
- **Action:** Scroll to features or open video modal

### Hero Visual Options

1. **Interactive Demo Canvas** - Mini version of editor with sample image
2. **Before/After Slider** - Dramatic transformation example
3. **Animated Screenshots** - Editor in action
4. **Video Background** - 10-15 second loop showing editing workflow

### Trust Badges (Below CTA)

- "✓ No credit card required"
- "✓ Works in Chrome, Safari, Firefox, Edge"
- "✓ Your images never leave your device"
- "✓ Used by 10,000+ creators" (when applicable)

---

## 5. Features Showcase

## Feature Presentation Strategy

Present features in order of **"Wow Factor"** first, then utility features.

---

## Feature 1: AI Upscaling

**Priority:** Highest

### Headline

"Upscale Images 2x with AI Precision"

### Description

"Transform low-resolution images into stunning high-resolution photos using our state-of-the-art AI model. Perfect for rescuing compressed images or preparing photos for print."

### Key Points - AI Upscaling

- 2x upscaling with detail enhancement
- Preserves edges and textures
- Works with any image format
- Powered by Real-ESRGAN technology

### Visual

Before/After comparison showing dramatic resolution improvement

---

## Feature 2: AI Healing Tool

**Priority:** Highest

### Headline - AI Healing

"Remove Anything. Keep Everything Else."

### Description

"Paint over unwanted objects, people, or blemishes - our AI intelligently fills in the background. No tedious clone stamping required."

### Key Points

- One-click object removal
- Intelligent background fill
- Adjustable brush size
- Non-destructive editing

### Visual

GIF showing removal of person from background

---

## Feature 3: AI Relighting

**Priority:** High

### Headline

"Change the Lighting. After the Shot."

### Description - AI Relighting

"Missed the golden hour? No problem. Our AI-powered relighting tool lets you add realistic directional lighting to any photo, transforming flat images into dramatic masterpieces."

### Key Points

- Realistic light simulation
- Interactive light positioning
- Adjustable intensity
- Works on faces and scenes

### Visual

Same photo with different lighting positions

---

## Feature 4: Liquify Tool

**Priority:** High

### Headline

"Sculpt Your Images with Precision"

### Description - Liquify Tool

"Professional-grade liquify tool for subtle retouching or creative distortion. Smoothly warp, push, pull, and reshape any part of your image."

### Key Points

- Multiple warp modes
- Adjustable brush pressure
- Real-time GPU preview
- Full undo support

### Visual

Subtle portrait retouching example

---

## Feature 5: Professional Develop Module

**Priority:** Medium

### Headline

"Lightroom-Quality Adjustments"

### Description - Develop Module

"Full suite of professional color grading tools including exposure, highlights, shadows, whites, blacks, vibrance, saturation, clarity, and more."

### Key Points

- 12+ adjustment sliders
- Real-time histogram
- Non-destructive workflow
- Keyboard shortcuts

### Visual

Side-by-side RAW-to-finished comparison

---

## Feature 6: Mask Layers

**Priority:** Medium

### Headline

"Selective Edits with Brush Masks"

### Description - Mask Layers

"Apply adjustments to specific areas of your image using our intuitive brush-based masking system. Create multiple mask layers for complex edits."

### Key Points

- Unlimited mask layers
- Add/erase brush modes
- Per-mask adjustments
- Visual feathering

### Visual

Portrait with separately adjusted sky and subject

---

## Feature 7: Crop & Transform

**Priority:** Low

### Headline

"Precise Cropping & Rotation"

### Description - Crop Transform

"Crop to any aspect ratio, rotate with degree precision, flip and transform. Everything you need to perfect your composition."

### Key Points

- Popular aspect ratio presets
- Free-form cropping
- Rotation with live preview
- Flip horizontal/vertical

### Visual

Grid overlay on crop example

---

## Feature 8: Export Options

**Priority:** Low

### Headline

"Export Your Way"

### Description - Export Options

"Save your edited images in PNG, JPEG, or WebP format with full quality control. Estimate file size before export."

### Key Points

- Multiple format support
- Quality slider
- File size estimation
- Custom filenames

### Visual

Export panel screenshot

---

## 6. How It Works

## 3-Step Process

### Step 1: Upload

**Headline:** "Drag, Drop, Done"
**Description:** "Drop any image onto Orlume or click to browse. We support JPG, PNG, WebP, and more."
**Visual:** Upload animation

### Step 2: Edit

**Headline:** "Transform with Powerful Tools"  
**Description:** "Use our professional develop tools, AI-powered features, and creative effects. See changes in real-time."
**Visual:** Editor interface with highlights

### Step 3: Export

**Headline:** "Download in Seconds"
**Description:** "Export in your preferred format and quality. Your masterpiece is ready to share."
**Visual:** Download button with formats

---

## 7. Use Cases & Examples

## Gallery Categories

### 1. Portrait Enhancement

- Skin smoothing
- Eye brightening
- Background adjustment
- Color grading for mood

### 2. Landscape Photography

- Sky replacement preparation
- HDR-style tonemapping
- Selective lighting
- Color enhancement

### 3. Product Photography

- Background cleanup
- Color correction
- Object removal
- Detail enhancement

### 4. Social Media Content

- Quick filters
- Consistent aesthetic
- Before/after creation
- Square cropping

### 5. Real Estate Photography

- Lighting correction
- Color balance
- Perspective hints
- Detail enhancement

### 6. Restoration & Enhancement

- Old photo enhancement
- Noise reduction via upscaling
- Color correction
- Damage removal

---

## 8. Pricing Strategy

## Recommended Tiers

### Free Tier

**Price:** $0/forever

**Includes:**

- All basic editing tools
- Develop module (full)
- Crop & Transform (full)
- Mask layers (up to 3)
- Export up to 4K resolution
- No watermarks

**Limitations:**

- AI features: 5/day
- No priority processing

---

### Pro Tier

**Price:** $9/month or $79/year (34% savings)

**Includes:**

- Everything in Free
- Unlimited AI features
- Priority AI processing
- 8K export resolution
- Batch processing (future)
- Early access to new features
- Email support

---

### Teams Tier (Future)

**Price:** $19/seat/month

**Includes:**

- Everything in Pro
- Shared presets
- Admin controls
- Priority support
- Custom branding (future)

---

## Pricing Page Elements

1. **Comparison table** - Clear feature matrix
2. **FAQ section** - Common questions
3. **Money-back guarantee** - 30-day refund policy
4. **Social proof** - User testimonials
5. **Usage calculator** - "How many AI edits do you need?"

---

## 9. Trust & Social Proof

## Essential Trust Elements

### 1. User Testimonials

Collect and display quotes from:

- Professional photographers
- Content creators
- Small business owners
- Hobbyists

**Format:**
> "Orlume replaced my Lightroom subscription. The AI upscaling is incredible."
> — Sarah M., Wedding Photographer

### 2. Usage Statistics (When Available)

- "10,000+ images edited this month"
- "Used in 50+ countries"
- "4.8/5 user satisfaction"

### 3. Technology Badges

- "Powered by WebGL2"
- "Real-ESRGAN AI"
- "Privacy-first design"

### 4. Security & Privacy Assurances

- "Images processed locally in your browser"
- "No server uploads for editing"
- "AI features use encrypted connections"
- "We never store or sell your images"

### 5. Press Mentions (Future)

- Product Hunt badge
- Tech blog mentions
- YouTube review embeds

### 6. Open Source Elements (Optional)

- GitHub stars badge
- Contribution welcome messaging
- Tech transparency

---

## 10. Call-to-Action Strategy

## Primary CTAs (High Priority)

| Location | CTA Text | Action |
|----------|----------|--------|
| Hero | "Start Editing Free" | Open /editor |
| End of features | "Try It Now" | Open /editor |
| Pricing table | "Get Started" | Open /editor or signup |
| Blog posts | "Edit This Photo" | Open /editor with sample |

## Secondary CTAs

| Location | CTA Text | Action |
|----------|----------|--------|
| Nav bar | "Open Editor" | Open /editor |
| Hero | "Watch Demo" | Video modal or /demo |
| Features | "Learn More" | Feature detail page |
| Footer | "Contact Us" | /contact |

## CTA Design Guidelines

- High contrast against background
- Consistent styling across site
- Minimum 44px touch target on mobile
- Hover/active states
- Loading state for actions

---

## 11. Technical Pages

## Page 1: Documentation (/docs)

### Sections

1. **Getting Started**
   - Browser requirements
   - First edit walkthrough
   - Understanding the interface

2. **Tool Guides**
   - Develop module deep-dive
   - Masking tutorial
   - AI tools guide
   - Crop & transform

3. **Keyboard Shortcuts**
   - Complete shortcut reference
   - Printable cheat sheet

4. **Troubleshooting**
   - Performance tips
   - Browser compatibility
   - Known issues

---

## Page 2: Comparison Pages (/compare)

### vs. Adobe Lightroom

| Feature | Orlume | Lightroom |
|---------|--------|-----------|
| Price | Free / $9mo | $10/mo |
| Installation | None | Required |
| AI Upscaling | ✓ | Add-on |
| AI Healing | ✓ | Limited |
| Privacy | Local | Cloud |

### vs. Photopea

| Feature | Orlume | Photopea |
|---------|--------|----------|
| Focus | Photography | Design |
| AI Tools | ✓ | Limited |
| GPU Accel | ✓ | ✗ |
| Complexity | Simple | Complex |

---

## Page 3: About (/about)

### Content

- Project story/origin
- Mission statement
- Team (if applicable)
- Tech stack overview
- Contact information
- Open source acknowledgments

---

## Page 4: Privacy Policy (/privacy)

### Key Points to Emphasize

- Local processing by default
- AI features data handling
- No tracking cookies
- GDPR compliance
- Data retention policy
- User rights

---

## Page 5: Blog (/blog)

### Content Strategy

1. **Tutorial posts** - How to achieve specific looks
2. **Feature announcements** - New releases
3. **Photography tips** - General education
4. **Behind the scenes** - Tech deep-dives
5. **User showcases** - Community highlights

### Recommended Initial Posts

1. "Introducing Orlume: Professional Editing in Your Browser"
2. "5 Quick Edits That Transform Any Portrait"
3. "How Our AI Upscaling Works"
4. "Orlume vs. Lightroom: Which is Right for You?"
5. "Keyboard Shortcuts That Will Speed Up Your Workflow"

---

## 12. SEO & Content Strategy

## Target Keywords

### Primary Keywords

- "online photo editor"
- "browser photo editor"
- "AI photo editor"
- "free photo editor"
- "photo editing tool"

### Long-tail Keywords

- "lightroom alternative free"
- "photo editor no download"
- "AI image upscaler online"
- "remove objects from photos free"
- "relight photos AI"
- "liquify tool online"

### Feature-Specific Keywords

- "AI upscale image online"
- "remove person from photo"
- "add lighting to photo"
- "crop photo online"
- "photo color grading online"

## Meta Tags Strategy

### Homepage

```html
<title>Orlume | Free AI Photo Editor - Edit Online, No Download</title>
<meta name="description" content="Professional photo editing in your browser. AI-powered upscaling, healing, and relighting. Free, fast, and private. No download required.">
```

### Features Page

```html
<title>Features | Orlume AI Photo Editor</title>
<meta name="description" content="Discover Orlume's powerful features: AI upscaling, smart healing, relighting, liquify, masks, and professional color grading tools.">
```

## Content Calendar (First 3 Months)

### Month 1: Launch

- Week 1: Launch announcement post
- Week 2: Getting started guide
- Week 3: AI features showcase
- Week 4: User tips compilation

### Month 2: Education

- Week 1: Portrait editing tutorial
- Week 2: Landscape editing tutorial
- Week 3: Comparison article (vs Lightroom)
- Week 4: Keyboard shortcuts guide

### Month 3: Growth

- Week 1: User success story
- Week 2: Advanced masking tutorial
- Week 3: Product Hunt launch post
- Week 4: Feature update announcement

---

## 13. Design Guidelines

## Color Palette

### Primary Colors

- **Brand Primary:** Deep Purple (#6B46C1) - Creativity, premium
- **Brand Secondary:** Vibrant Cyan (#22D3EE) - Tech, modern
- **Accent:** Warm Orange (#F97316) - CTAs, highlights

### Neutral Colors

- **Background Dark:** #0F0F1A (editor feel)
- **Background Light:** #FAFAFA (landing pages)
- **Text Primary:** #1A1A2E
- **Text Secondary:** #64748B

## Typography

### Headlines

- **Font:** Inter or Plus Jakarta Sans
- **Weight:** 700-800
- **Size:** 48-72px (desktop), 32-48px (mobile)

### Body

- **Font:** Inter or System UI
- **Weight:** 400-500
- **Size:** 16-18px
- **Line Height:** 1.6

## Visual Style

### Imagery

- Dark, moody photography samples
- Before/after comparisons
- UI screenshots with depth shadows
- Subtle gradient overlays

### Animations

- Smooth fade-ins on scroll
- Micro-interactions on hover
- Page transitions
- Loading skeletons

### Layout

- Generous whitespace
- Max content width: 1200px
- Grid-based sections
- Mobile-first approach

---

## 14. Competitive Positioning

## Positioning Statement

> **For** amateur photographers and content creators  
> **Who** need powerful photo editing without expensive subscriptions or complex software,  
> **Orlume** is a browser-based AI photo editor  
> **That** delivers professional results instantly.  
> **Unlike** Adobe Lightroom or Photoshop,  
> **Orlume** requires no download, runs on any device, and offers AI-powered features for free.

## Key Differentiators

| Competitor | Their Weakness | Orlume's Advantage |
|------------|---------------|-------------------|
| Adobe Lightroom | Expensive subscription | Free core features |
| Photopea | Cluttered interface | Clean, focused UI |
| Canva | Limited editing depth | Professional tools |
| Pixlr | Outdated feel | Modern GPU-powered |
| Fotor | Heavy ads | Clean experience |

## Feature Comparison Matrix

| Feature | Orlume | Lightroom | Photopea | Canva |
|---------|--------|-----------|----------|-------|
| Browser-based | ✓ | Partial | ✓ | ✓ |
| Free tier | ✓ | ✗ | ✓ | ✓ |
| AI Upscaling | ✓ | Add-on | ✗ | ✗ |
| AI Healing | ✓ | Limited | ✗ | ✗ |
| GPU-accelerated | ✓ | Desktop | ✗ | ✗ |
| Privacy-first | ✓ | ✗ | Partial | ✗ |
| Real-time preview | ✓ | ✓ | ✗ | Limited |

---

## 15. Launch Checklist

## Pre-Launch (2 weeks before)

- [ ] Landing page complete and tested
- [ ] Editor stable and tested across browsers
- [ ] Documentation written
- [ ] Privacy policy and terms published
- [ ] Analytics installed (privacy-respecting)
- [ ] Error tracking setup
- [ ] Social media accounts created
- [ ] Launch assets prepared (screenshots, videos)

## Launch Day

- [ ] Deploy landing page
- [ ] Submit to Product Hunt
- [ ] Post on relevant subreddits
- [ ] Share on Twitter/X
- [ ] Post on Hacker News
- [ ] Submit to alternative.to
- [ ] Submit to IndieHackers
- [ ] Reach out to tech bloggers

## Post-Launch (First week)

- [ ] Monitor analytics and feedback
- [ ] Respond to all comments/reviews
- [ ] Fix any critical bugs immediately
- [ ] Collect user testimonials
- [ ] Plan first feature update
- [ ] Write follow-up blog post

## Ongoing

- [ ] Weekly blog posts
- [ ] Monthly feature updates
- [ ] Quarterly user surveys
- [ ] Continuous SEO optimization
- [ ] Community building

---

# Appendix A: Copywriting Examples

## Headlines Bank

### Benefit-Focused

- "Professional Results in Minutes, Not Hours"
- "Edit Like a Pro. No Experience Required."
- "Your Photos, Transformed by AI"

### Problem-Solving

- "Tired of Complex Photo Software?"
- "Finally, a Photo Editor That Just Works"
- "No Downloads. No Subscriptions. No Problem."

### Tech-Focused

- "GPU-Powered Editing in Your Browser"
- "AI That Understands Your Photos"
- "WebGL2 Performance, Lightroom Power"

## Tagline Options

1. "Edit Anywhere. Create Everywhere."
2. "AI-Powered. Browser-Based. Brilliant."
3. "Professional Editing. Zero Friction."
4. "Where Photos Come to Life."

---

# Appendix B: Recommended Tools

## Website Development

- **Framework:** Next.js or Astro (for SSG)
- **Styling:** Tailwind CSS
- **Animations:** Framer Motion
- **CMS:** Sanity or Contentful (for blog)

## Analytics & Tracking

- **Analytics:** Plausible or Fathom (privacy-focused)
- **Error Tracking:** Sentry
- **Heat Maps:** Hotjar (optional)

## Marketing

- **Email:** Resend or Buttondown
- **Social Scheduling:** Buffer or Hootsuite
- **SEO:** Ahrefs or Ubersuggest

## Asset Creation

- **Design:** Figma
- **Screenshots:** CleanShot X
- **Videos:** Screen Studio or Loom

---

# Appendix C: Page Content Estimates

| Page | Sections | Est. Word Count |
|------|----------|-----------------|
| Homepage | 8-10 | 1,500-2,000 |
| Features | 8 features | 2,000-2,500 |
| Pricing | 3 tiers + FAQ | 800-1,000 |
| About | 4-5 | 600-800 |
| Docs (all) | 10+ articles | 5,000+ |
| Blog (initial) | 5 posts | 5,000-7,500 |
| **Total** | | **15,000+** |

---

# Appendix D: Quick Reference

## Must-Have Pages

1. ✅ Homepage (Landing)
2. ✅ Editor (Product)
3. ✅ Features overview
4. ✅ Pricing
5. ✅ Privacy Policy
6. ✅ Terms of Service

## Nice-to-Have Pages

1. ⭕ Blog
2. ⭕ Documentation
3. ⭕ Examples gallery
4. ⭕ Comparison pages
5. ⭕ About page
6. ⭕ Changelog

## Essential Components

- [ ] Navigation bar
- [ ] Footer with links
- [ ] CTA buttons
- [ ] Feature cards
- [ ] Testimonials
- [ ] FAQ accordion
- [ ] Pricing table
- [ ] Before/after slider

---

**End of Document**

*This document should be treated as a living guide. Update sections as the product evolves and new insights are gathered from user feedback and analytics.*

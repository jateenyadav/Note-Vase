# Note Vase

> A beautiful, fast, and private notes app built with **vanilla HTML/CSS/JavaScript**. No frameworks, no backend, no tracking — your notes never leave your browser.

![Stack](https://img.shields.io/badge/stack-vanilla%20JS-yellow) ![Storage](https://img.shields.io/badge/storage-localStorage-blue) ![Offline](https://img.shields.io/badge/offline-100%25-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

Note Vase is a portfolio-grade reimagining of the classic local-storage notes demo. It ships a delightful, accessible UI, a solid editing experience, Markdown previews, and dozens of small touches that make it pleasant to use every day.

---

## ✨ Features

### Writing & Organisation
- **Rich Markdown editor** with live preview (`⌘/Ctrl + E`)
- **Toolbar shortcuts** for bold, italic, strike, headings, quote, lists, task lists, inline code and links
- **Tags** with a sidebar tag cloud and `#tag` search
- **Color labels** (Amber, Rose, Emerald, Sky, Violet) with subtle accent stripes
- **Pin** important notes to the top (`P` while editing)
- **Archive** finished notes to keep your workspace clean
- **Soft-delete to Trash** with restore + empty trash
- **Auto-save drafts** so you never lose a thought mid-write

### Browse & Find
- Instant **fuzzy search** on title, body, and `#tags` (`/` to focus)
- **Sort** by Updated, Created, or A→Z
- **Grid & List** layouts
- Sidebar **filters**: All / Pinned / Archived / Trash
- Live **counts**, total **word count** and **storage** usage

### Productivity
- **Full keyboard shortcut set** (press `?` to view)
- **Toast notifications** with undo for destructive actions
- **Confirmation modals** for irreversible actions
- **Export / Import** your library as JSON

### Design & Accessibility
- Dual **light / dark** themes with system-preference detection (`T` to toggle)
- Animated gradient ambient background, glass surfaces, smooth motion
- Respects `prefers-reduced-motion`
- ARIA labels, focus states, semantic markup
- Fully **responsive** — sidebar collapses on mobile

---

## 🚀 Getting Started

Note Vase is a static site. Any HTTP server works.

```bash
# clone
git clone https://github.com/Jateen-yadav/Note-Vase.git
cd Note-Vase/app

# serve (any of these)
python3 -m http.server 8000
# or
npx serve .
```

Then open [http://localhost:8000](http://localhost:8000).

> **Tip:** opening `index.html` directly via `file://` works too, but a tiny static server avoids browser quirks.

---

## ⌨️ Keyboard Shortcuts

| Shortcut          | Action               |
| ----------------- | -------------------- |
| `N`               | New note             |
| `/`               | Focus search         |
| `⌘/Ctrl + S`      | Save current note    |
| `⌘/Ctrl + E`      | Toggle preview       |
| `P`               | Pin / unpin          |
| `T`               | Cycle theme          |
| `?`               | Show shortcuts       |
| `Esc`             | Close dialogs        |

---

## 🗂️ Project Structure

```
Note-Vase/
└── app/
    ├── index.html        # Semantic UI shell
    ├── css/styles.css    # Theming, layout, components
    └── js/app.js         # The notes engine (vanilla JS)
```

---

## 🔐 Privacy

Everything lives in `localStorage` under the key `noteVase.notes.v2`. There is no network call, no analytics, no tracking. You can export to JSON at any time, and clearing site data wipes the app.

---

## 🛠️ Built With

- HTML5, CSS3 (custom properties, `color-mix`, `backdrop-filter`)
- Vanilla JavaScript (ES2020+)
- [Inter](https://rsms.me/inter/) & [JetBrains Mono](https://www.jetbrains.com/lp/mono/)

---

## 📜 License

MIT © [Jateen Yadav](https://github.com/Jateen-yadav)

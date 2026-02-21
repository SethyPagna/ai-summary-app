# AI Summary App

An intelligent document summarization web application powered by Claude AI and Supabase.

## Features

- **Multi-format Support**: Summarize PDF, DOCX, DOC, PPT, PPTX, and TXT files
- **Simultaneous Processing**: Upload and process multiple files at once
- **AI-Powered Chat**: Ask questions about your documents via integrated chat
- **Project Organization**: Group documents into projects for easy management
- **File History**: Track all previously uploaded documents
- **Dark Mode**: Full dark/light theme toggle
- **Readability Controls**: Adjust font size, line height, and letter spacing
- **Supabase Auth**: Sign up, login, and logout with Supabase authentication
- **Cloud Storage**: Files stored in the `app-files` Supabase bucket
- **PDF Worker Bundling**: Robust local PDF.js worker via Vite's worker bundling

## Setup

### Prerequisites

- Node.js 18+
- Supabase account with the required tables and storage bucket

### Supabase Tables Required

```sql
-- projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  name text,
  created_at timestamptz default now()
);

-- documents
create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  user_id uuid references auth.users,
  name text,
  content text,
  summary text,
  created_at timestamptz default now()
);

-- chat_messages
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  user_id uuid references auth.users,
  role text,
  text text,
  created_at timestamptz default now()
);
```

### Storage Bucket

Create a bucket named `app-files` in Supabase Storage with appropriate RLS policies.

### Environment

No `.env` file needed — Supabase keys are embedded in `src/lib/supabase.js`.

### Install & Run

```bash
npm install
npm run dev
```

### Build for Production

```bash
npm run build
npm run preview
```

## Architecture

```
src/
├── components/
│   ├── AuthPage.jsx        # Login / Sign-up page
│   ├── Sidebar.jsx         # Navigation sidebar
│   ├── Dashboard.jsx       # Home dashboard with stats
│   ├── ProjectView.jsx     # Per-project view (upload, summary, chat)
│   ├── FileUpload.jsx      # Drag-and-drop file upload + processing
│   ├── SummaryPanel.jsx    # Tabbed AI summary viewer
│   ├── ChatPanel.jsx       # Document Q&A chat interface
│   ├── FileHistory.jsx     # All-time file history
│   ├── Settings.jsx        # Readability + theme settings
│   └── NewProjectModal.jsx # Project creation modal
├── hooks/
│   ├── useAuth.jsx         # Auth context + hook
│   └── useToast.jsx        # Toast notifications
├── lib/
│   ├── supabase.js         # Supabase client
│   ├── extractor.js        # PDF/DOCX text extraction
│   └── ai.js              # Anthropic API calls
├── styles/
│   └── app.css            # Full CSS with dark mode & responsive
├── App.jsx                 # Root component
└── main.jsx               # Entry point
```

## How It Works

1. **Sign in** or create an account via Supabase Auth
2. **Create a project** from the dashboard or sidebar
3. **Upload files** — they're extracted, summarized by Claude, and stored in Supabase
4. **View summaries** in the tabbed summary panel
5. **Chat** with your documents using natural language questions
6. **Track history** of all uploaded documents across projects

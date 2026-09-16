// Thin client for the course-editor FastAPI backend (api/app.py).
// The base URL is configurable via VITE_EDITOR_API but defaults to the
// local uvicorn dev port.

const API_BASE =
  (import.meta as any).env?.VITE_EDITOR_API ?? "http://localhost:8000";

export interface CourseSummary {
  id: string;
  title: string;
}

export interface LabSummary {
  slug: string;
  title: string;
  order: number;
  kind: "workshop" | "page";
}

export interface LabDetail {
  slug: string;
  body: string;
  manifest: Record<string, unknown>;
  /** Fingerprint of the body on disk; sent back as baseHash on save. */
  bodyHash?: string;
}

export interface StructureLab {
  slug: string;
  title: string;
  kind: "workshop" | "page";
}

export interface StructureTopic {
  title: string;
  labs: StructureLab[];
}

export interface Structure {
  topics: StructureTopic[];
}

export interface PublishDiff {
  course: string;
  remoteCommit: string;
  newCourse: boolean;
  upToDate: boolean;
  added: string[];
  modified: string[];
  removed: string[];
}

export interface PublishResult {
  ok: boolean;
  upToDate: boolean;
  commit: string;
  changed?: { added: number; modified: number; removed: number };
  /** Present when the publish also committed the authoring repo. */
  authoring?: { committed: boolean; commit?: string; upToDate?: boolean } | null;
}

export type Provider = "ollama" | "anthropic" | "openai";

export interface Settings {
  provider: Provider;
  ollama: { url: string; model: string };
  anthropic: { model: string };
  openai: { model: string };
  docs: { enabled: boolean; url: string };
  keys: { anthropic: boolean; openai: boolean };
  ollamaModels: string[];
  gpu: boolean;
}

export interface ModelSuggestion {
  profile: "cpu" | "gpu";
  gpu: boolean;
  model: string | null;
  reason: string;
}

export interface ProviderHealth {
  provider: Provider;
  ok: boolean;
  model: string;
  detail: string;
  models?: string[];
}

export interface Source { title: string; url: string }

export interface OutlineLab { title: string; summary: string }
export interface OutlineTopic { title: string; labs: OutlineLab[] }
export interface Outline { courseTitle: string; topics: OutlineTopic[] }
export interface ImportOutline { importId: string; chars: number; outline: Outline }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = (data as any).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

/** What a tool lookup found: a bundled copy, one on PATH, or nothing. */
export interface ToolStatus {
  found: boolean;
  path: string | null;
  bundled: boolean;
}

/** The backend's answer to "am I usable on this machine, and how much?" */
export interface SetupStatus {
  /** The Content Manager checkout we are pointed at. */
  pcmRepo: string;
  /** False only when the courses are not there — the one fatal case. */
  valid: boolean;
  reason: string | null;
  defaultRepo: string;
  /** Are the Content Manager's authoring scripts present? */
  scaffolding: boolean;
  tools: { node: ToolStatus; git: ToolStatus };
  /** Features that will not work here, in the words of their buttons. */
  unavailable: string[];
  /** Checkouts found on this machine. Populated only when we are lost. */
  candidates: { path: string; scaffolding: boolean }[];
}

export const api = {
  base: API_BASE,

  async health(): Promise<{ ok: boolean; coursesDir: string; needsSetup?: boolean }> {
    return json(await fetch(`${API_BASE}/api/health`));
  },

  async setup(): Promise<SetupStatus> {
    return json(await fetch(`${API_BASE}/api/setup`));
  },

  /** Point the editor at a Content Manager checkout. Throws with the
   *  backend's reason when the folder is not one — the same sentence the
   *  first-run screen shows, so the check and the message cannot drift. */
  async setRepo(path: string): Promise<SetupStatus> {
    return json(
      await fetch(`${API_BASE}/api/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }),
    );
  },

  async listCourses(): Promise<CourseSummary[]> {
    return json(await fetch(`${API_BASE}/api/courses`));
  },

  async createCourse(title: string, kind: "workshop" | "academy"): Promise<CourseSummary> {
    return json(
      await fetch(`${API_BASE}/api/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind }),
      }),
    );
  },

  async verifyCourse(course: string): Promise<{ ok: boolean; output: string }> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/verify`, { method: "POST" }),
    );
  },

  async listLabs(course: string): Promise<LabSummary[]> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/labs`));
  },

  async getLab(course: string, lab: string): Promise<LabDetail> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}`));
  },

  /**
   * Save a lab. `body: null` is a manifest-only save (the guide on disk is
   * left untouched). `opts.baseHash` is the bodyHash this tab loaded; the
   * API answers 409 if the disk copy changed since, unless `opts.force`.
   */
  async saveLab(
    course: string,
    lab: string,
    body: string | null,
    manifest?: Record<string, unknown>,
    opts?: { baseHash?: string; force?: boolean },
  ): Promise<LabDetail> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, manifest, baseHash: opts?.baseHash, force: opts?.force ?? false }),
      }),
    );
  },

  async getStructure(course: string): Promise<Structure> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/structure`));
  },

  async putStructure(course: string, structure: Structure): Promise<Structure> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/structure`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(structure),
      }),
    );
  },

  async ollamaHealth(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    return json(await fetch(`${API_BASE}/api/ollama/health`));
  },

  async getSettings(): Promise<Settings> {
    return json(await fetch(`${API_BASE}/api/settings`));
  },

  async putSettings(patch: Partial<Omit<Settings, "keys" | "ollamaModels">>): Promise<Settings> {
    return json(
      await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  async providerHealth(): Promise<ProviderHealth> {
    return json(await fetch(`${API_BASE}/api/providers/health`));
  },

  async suggestModel(profile: "auto" | "cpu" | "gpu"): Promise<ModelSuggestion> {
    return json(await fetch(`${API_BASE}/api/providers/suggest?profile=${profile}`));
  },

  async docsTest(url: string): Promise<{ ok: boolean; count?: number; sample?: string[]; error?: string }> {
    return json(await fetch(`${API_BASE}/api/docs/test?url=${encodeURIComponent(url)}`));
  },

  async uploadAsset(course: string, file: File | Blob, filename?: string): Promise<{ name: string; path: string }> {
    const form = new FormData();
    form.append("file", file, filename ?? (file as File).name ?? "image.png");
    return json(await fetch(`${API_BASE}/api/courses/${course}/assets`, { method: "POST", body: form }));
  },

  async listLabFiles(course: string, lab: string): Promise<string[]> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}/files`));
  },

  async uploadLabFile(course: string, lab: string, file: File): Promise<{ name: string; path: string }> {
    const form = new FormData();
    form.append("file", file);
    return json(await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}/files`, { method: "POST", body: form }));
  },

  async getCourse(course: string): Promise<Record<string, unknown>> {
    return json(await fetch(`${API_BASE}/api/courses/${course}`));
  },

  async putCourse(course: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  async chat(messages: { role: "user" | "assistant"; content: string }[], context?: string): Promise<{ reply: string; sources: Source[] }> {
    return json(
      await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, context }),
      }),
    );
  },

  exportUrl(course: string): string {
    return `${API_BASE}/api/courses/${course}/export`;
  },

  async installCourse(course: string): Promise<{ ok: boolean; output: string }> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/install`, { method: "POST" }));
  },

  /** Delete a lab or page — its folder AND its SUMMARY.md bullet. */
  async deleteLab(course: string, lab: string): Promise<Structure> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}`, { method: "DELETE" }),
    );
  },

  async deleteCourse(course: string, confirm: string): Promise<{ ok: boolean; id: string }> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      }),
    );
  },

  async publishConfig(): Promise<{ url: string; ref: string }> {
    return json(await fetch(`${API_BASE}/api/publish/config`));
  },

  async publishDiff(course: string): Promise<PublishDiff> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/publish/diff`));
  },

  async publishCourse(course: string, message?: string, commit = false): Promise<PublishResult> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message || null, commit }),
      }),
    );
  },

  async publishTag(tag: string, message?: string): Promise<{ ok: boolean; tag: string; commit: string }> {
    return json(
      await fetch(`${API_BASE}/api/publish/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, message: message || null }),
      }),
    );
  },

  /** `findings` is left `unknown` on purpose — parseFindings validates the
   *  shape, so an older backend that answers with prose alone is a fallback
   *  to the panel rather than a type error. */
  async review(body: string): Promise<{ review: string; findings?: unknown; sources: Source[] }> {
    return json(
      await fetch(`${API_BASE}/api/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }),
    );
  },

  async rewrite(text: string, instruction?: string): Promise<{ text: string; sources: Source[] }> {
    return json(
      await fetch(`${API_BASE}/api/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, instruction }),
      }),
    );
  },

  async importOutline(file: File): Promise<ImportOutline> {
    const form = new FormData();
    form.append("file", file);
    return json(
      await fetch(`${API_BASE}/api/import/outline`, { method: "POST", body: form }),
    );
  },

  async importBuild(
    importId: string,
    outline: Outline,
    kind: "workshop" | "academy",
  ): Promise<{ courseId: string; labCount: number; sources: Source[] }> {
    return json(
      await fetch(`${API_BASE}/api/import/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId, outline, kind }),
      }),
    );
  },

  async generateLab(
    course: string,
    title: string,
    outline: string,
    topic: string,
    kind: "workshop" | "page",
  ): Promise<{ slug: string; structure: Structure; sources: Source[] }> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/generate-lab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, outline, topic, kind }),
      }),
    );
  },

  async createLab(
    course: string,
    title: string,
    topic: string,
    kind: "workshop" | "page",
  ): Promise<Structure> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/labs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, topic, kind }),
      }),
    );
  },

  /** Base URL the preview should use for a lab's relative asset refs.
   *  Mirrors the packaged app: refs like `../_assets/images/x.png` and
   *  `files/y.png` resolve correctly against `<course>/tree/<lab>/`. */
  assetBaseUrl(course: string, lab: string): string {
    return `${API_BASE}/api/courses/${course}/tree/${lab}/`;
  },
};
